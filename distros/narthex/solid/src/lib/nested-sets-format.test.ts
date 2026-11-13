import { describe, expect, test } from "bun:test";
import {
  crossingCellText,
  familyTitle,
  lifeFormTitle,
  nestedSetsInlineText,
  readNestedSets,
  readVerdict,
  relationText,
  relationTooltip,
  verdictText,
  relationNeedsWords,
  verdictNeedsWords,
  namedAnswerNeedsWords,
  namedAnswerText,
  type CrossingTable,
  type FamilySet,
  type LifeFormSet,
  type NamedSet,
} from "./nested-sets-format";

// The shapes plants.fenel's encyclopediaSpeciesSets returns for the supplied
// collection (Apiaceae; Foeniculum with common fennel, Ferula with giant fennel).
const just = (value: unknown) => ({ $tag: "Just", _0: value });
const nothing = { $tag: "Nothing" };
const apiaceae = { $tag: "PlantFamily", scientificName: "Apiaceae", commonNames: ["carrot family", "umbellifers"], source: "https://www.gbif.org/species/6720" };
const foeniculum = { $tag: "PlantGenus", scientificName: "Foeniculum", authority: "Hill", family: apiaceae, source: "https://www.gbif.org/species/10704390" };
const ferula = { $tag: "PlantGenus", scientificName: "Ferula", authority: "L.", family: apiaceae, source: "https://www.gbif.org/species/3034682" };
const fennel = { $tag: "PlantSpecies", scientificName: "Foeniculum vulgare", authority: "Mill.", genus: foeniculum,
  commonNames: ["fennel", "common fennel"], lifeForm: { $tag: "PlantPerennial" }, nativeRange: "Mediterranean to Ethiopia and western Nepal", source: "https://powo.science.kew.org/taxon/842680-1" };
const giant = { $tag: "PlantSpecies", scientificName: "Ferula communis", authority: "L.", genus: ferula,
  commonNames: ["giant fennel"], lifeForm: { $tag: "PlantPerennial" }, nativeRange: "Mediterranean to the Arabian Peninsula and Tanzania", source: "https://powo.science.kew.org/taxon/842235-1" };
const enumOf = (values: unknown[]) => ({ $tag: "SeEnum", values });
const speciesSet = (taxon: unknown, members: unknown[]) => ({ $tag: "PlantSpeciesSet", taxon, members, constraint: enumOf(members) });
const familySet = speciesSet({ $tag: "TaxonFamily", _0: apiaceae }, [fennel, giant]);
const foeniculumSet = speciesSet({ $tag: "TaxonGenus", _0: foeniculum }, [fennel]);
const ferulaSet = speciesSet({ $tag: "TaxonGenus", _0: ferula }, [giant]);
const comparison = (first: unknown, second: unknown, verdicts: [unknown, unknown, unknown], shared: unknown[]) => ({
  $tag: "PlantSpeciesSetComparison", first, second,
  firstWithinSecond: verdicts[0], secondWithinFirst: verdicts[1], disjoint: verdicts[2], shared, onlyFirst: [], onlySecond: [],
});

function familyValue(overrides: Record<string, unknown> = {}) {
  return {
    $tag: "PlantFamilySpeciesSets",
    family: familySet,
    genera: [foeniculumSet, ferulaSet],
    genusWithinFamily: [
      comparison(foeniculumSet, familySet, [just(true), just(false), just(false)], [fennel]),
      comparison(ferulaSet, familySet, [just(true), just(false), just(false)], [giant]),
    ],
    genusComparisons: [comparison(foeniculumSet, ferulaSet, [just(false), just(false), just(true)], [])],
    union: { $tag: "PlantSpeciesSetUnion", members: [fennel, giant], constraint: { $tag: "SeUnion", branches: [] },
      unionWithinFamily: just(true), familyWithinUnion: just(true) },
    ...overrides,
  };
}

const coverage = "These sets contain the species described in this collection. Other species are not listed here.";
const collection = (families: unknown) => ({ $tag: "PlantSpeciesSetsInCollection", coverage, families });

function onlyFamily(value: unknown): FamilySet {
  const model = readNestedSets(value);
  if (model?.kind !== "collection" || !model.families) throw new Error("Expected decided families");
  expect(model.families).toHaveLength(1);
  return model.families[0]!;
}

describe("readVerdict", () => {
  test("reads Just true, Just false and Nothing; refuses anything else", () => {
    expect(readVerdict(just(true))).toBe("true");
    expect(readVerdict(just(false))).toBe("false");
    expect(readVerdict(just({ $tag: "True" }))).toBe("true");
    expect(readVerdict(nothing)).toBe("undecided");
    expect(readVerdict(true)).toBeUndefined();
    expect(readVerdict(just("yes"))).toBeUndefined();
    expect(readVerdict(undefined)).toBeUndefined();
  });
});

describe("readNestedSets", () => {
  test("the collection reads as one family box holding two genus boxes of species chips", () => {
    const family = onlyFamily(collection(just([familyValue()])));
    expect(familyTitle(family)).toBe("Apiaceae · carrot family");
    expect(family.countText).toBe("2 species");
    expect(family.genera.map((genus) => [genus.name, genus.countText, genus.verdict])).toEqual([
      ["Foeniculum", "1 species", "true"], ["Ferula", "1 species", "true"],
    ]);
    expect(family.genera.map((genus) => genus.species)).toEqual([
      [{ common: "Fennel", scientific: "Foeniculum vulgare" }],
      [{ common: "Giant fennel", scientific: "Ferula communis" }],
    ]);
    expect(family.relations.map(relationText)).toEqual(["The 2 genus sets are pairwise disjoint", "Their union is Apiaceae"]);
    expect(family.relations.map(relationTooltip)).toEqual([
      "Every pair of Foeniculum, Ferula has an empty intersection, decided by Fenel's set judgment",
      "Foeniculum ∪ Ferula = Apiaceae, decided by Fenel's set judgment",
    ]);
    const model = readNestedSets(collection(just([familyValue()])));
    expect(model?.kind === "collection" && model.coverage).toBe(coverage);
  });

  test("verdict chips follow the data only: Nothing is not decided, Just false is not a subset", () => {
    const value = familyValue({ genusWithinFamily: [
      comparison(foeniculumSet, familySet, [nothing, nothing, nothing], []),
      comparison(ferulaSet, familySet, [just(false), just(false), just(false)], []),
    ] });
    const family = onlyFamily(collection(just([value])));
    expect(family.genera.map((genus) => genus.verdict)).toEqual(["undecided", "false"]);
    expect(verdictText("true", "Apiaceae")).toBe("⊆ Apiaceae");
    expect(verdictText("undecided", "Apiaceae")).toBe("not decided");
    expect(verdictText("false", "Apiaceae")).toBe("not a subset");
    expect(nestedSetsInlineText({ kind: "family", family })).toBe("Apiaceae, 2 species");
  });

  test("only an answer the drawing alone would get wrong is written out", () => {
    // Boxes drawn apart that fill their family: the two expected relations need no sentence.
    expect([{ kind: "pairwise-disjoint", terms: ["A", "B"] }, { kind: "union-equal", terms: ["A", "B"], whole: "F" }]
      .map(relation => relationNeedsWords(relation as never))).toEqual([false, false]);
    expect([{ kind: "shared", terms: ["A", "B"], shared: [] }, { kind: "overlap-undecided", terms: ["A", "B"] },
      { kind: "union-within", terms: ["A", "B"], whole: "F" }].map(relation => relationNeedsWords(relation as never))).toEqual([true, true, true]);
    // A box inside its family reads "within": only "not a subset" and "not decided" are written.
    expect((["true", "false", "undecided", undefined] as const).map(verdictNeedsWords)).toEqual([false, true, true, false]);
  });

  test("a species record holding a picture keeps it on its chip; one without has no picture key", () => {
    const picture = { width: 1, height: 1, pixels: [{ r: 10, g: 20, b: 30, a: 255 }] };
    const pictured = { ...fennel, photo: just(picture) };
    const withPicture = speciesSet({ $tag: "TaxonGenus", _0: foeniculum }, [pictured]);
    const family = onlyFamily(collection(just([familyValue({ genera: [withPicture, ferulaSet] })])));
    expect(family.genera[0]!.species[0]!.picture).toEqual(picture);
    expect("picture" in family.genera[1]!.species[0]!).toBe(false);
  });

  test("a genus with no comparison against its family gets no verdict at all", () => {
    const family = onlyFamily(collection(just([familyValue({ genusWithinFamily: [] })])));
    expect(family.genera.map((genus) => genus.verdict)).toEqual([undefined, undefined]);
  });

  test("comparisons are matched by their taxa, not only by position", () => {
    const within = familyValue().genusWithinFamily;
    const swapped = familyValue({ genusWithinFamily: [
      comparison(ferulaSet, familySet, [just(false), just(false), just(false)], []),
      within[0],
    ] });
    expect(onlyFamily(collection(just([swapped]))).genera.map((genus) => genus.verdict)).toEqual(["true", "false"]);
  });

  test("overlap and union relations appear only as the data decides them", () => {
    const overlapping = familyValue({
      genusComparisons: [comparison(foeniculumSet, ferulaSet, [just(false), just(false), just(false)], [fennel])],
      union: { members: [fennel, giant], unionWithinFamily: just(true), familyWithinUnion: nothing },
    });
    expect(onlyFamily(collection(just([overlapping]))).relations.map(relationText))
      .toEqual(["Foeniculum ∩ Ferula = {Fennel}", "Their union is a subset of Apiaceae"]);
    const undecided = familyValue({
      genusComparisons: [comparison(foeniculumSet, ferulaSet, [nothing, nothing, nothing], [])],
      union: { members: [], unionWithinFamily: nothing, familyWithinUnion: just(true) },
    });
    expect(onlyFamily(collection(just([undecided]))).relations.map(relationText)).toEqual(["Foeniculum ∩ Ferula: not decided"]);
  });

  test("an undecided selection keeps Nothing; an empty decided selection has no families", () => {
    expect(readNestedSets(collection(nothing))).toEqual({ kind: "collection", coverage, families: undefined });
    expect(nestedSetsInlineText(readNestedSets(collection(nothing))!)).toBe("Not decided");
    expect(readNestedSets(collection(just([])))).toEqual({ kind: "collection", coverage, families: [] });
  });

  test("a single family value reads on its own, with the one-line form", () => {
    const model = readNestedSets(familyValue());
    expect(model?.kind).toBe("family");
    expect(nestedSetsInlineText(model!)).toBe("Apiaceae ⊇ Foeniculum, Ferula");
    expect(nestedSetsInlineText(readNestedSets(collection(just([familyValue(), familyValue()])))!))
      .toBe("Apiaceae ⊇ Foeniculum, Ferula; Apiaceae ⊇ Foeniculum, Ferula");
  });

  test("unrecognised shapes answer undefined so the structural reader draws them", () => {
    expect(readNestedSets(undefined)).toBeUndefined();
    expect(readNestedSets([familyValue()])).toBeUndefined();
    expect(readNestedSets({ coverage, families: [familyValue()] })).toBeUndefined();
    expect(readNestedSets(collection(just([{ ...familyValue(), genera: "Foeniculum" }])))).toBeUndefined();
    expect(readNestedSets(collection(just([familyValue({ union: { unionWithinFamily: true, familyWithinUnion: true } })])))).toBeUndefined();
    expect(readNestedSets(familyValue({ family: { ...familySet, taxon: { $tag: "TaxonOrder", _0: apiaceae } } }))).toBeUndefined();
    expect(readNestedSets(familyValue({ genera: [{ ...foeniculumSet, members: [{ scientificName: 3 }] }] }))).toBeUndefined();
  });
});

// The larger collection: three families, a genus with two species, the sets by
// life form and each family crossed with each life form (plants.fenel
// encyclopediaSpeciesSets after the life-form sets were added).
const plantFamily = (name: string, common: string) => ({ $tag: "PlantFamily", scientificName: name, commonNames: [common], source: "https://www.gbif.org/" });
const plantGenus = (name: string, family: unknown) => ({ $tag: "PlantGenus", scientificName: name, authority: "L.", family, source: "https://www.gbif.org/" });
const plant = (name: string, common: string, genus: unknown, lifeForm: string) => ({ $tag: "PlantSpecies", scientificName: name, authority: "L.",
  genus, commonNames: [common], lifeForm: { $tag: lifeForm }, nativeRange: "", source: "https://powo.science.kew.org/" });

const asteraceae = plantFamily("Asteraceae", "daisy family");
const helianthus = plantGenus("Helianthus", asteraceae);
const arctium = plantGenus("Arctium", asteraceae);
const sunflower = plant("Helianthus annuus", "sunflower", helianthus, "PlantAnnual");
const jerusalemArtichoke = plant("Helianthus tuberosus", "Jerusalem artichoke", helianthus, "PlantPerennial");
const lesserBurdock = plant("Arctium minus", "lesser burdock", arctium, "PlantBiennial");
const solanaceae = plantFamily("Solanaceae", "nightshade family");
const solanum = plantGenus("Solanum", solanaceae);
const datura = plantGenus("Datura", solanaceae);
const potato = plant("Solanum tuberosum", "potato", solanum, "PlantPerennial");
const cutleafNightshade = plant("Solanum triflorum", "cutleaf nightshade", solanum, "PlantAnnual");
const thornApple = plant("Datura stramonium", "thorn apple", datura, "PlantAnnual");

/** A PlantFamilySpeciesSets whose genus pairs are all decided disjoint unless
 * `pairVerdict` says otherwise for a pair. */
function decidedFamily(family: unknown, genera: Array<[unknown, unknown[]]>,
  pairVerdict: (first: number, second: number) => unknown = () => just(true)) {
  const members = genera.flatMap(([, rows]) => rows);
  const whole = speciesSet({ $tag: "TaxonFamily", _0: family }, members);
  const sets = genera.map(([genus, rows]) => speciesSet({ $tag: "TaxonGenus", _0: genus }, rows));
  const pairs = sets.flatMap((first, i) => sets.slice(i + 1).map((second, offset) =>
    comparison(first, second, [just(false), just(false), pairVerdict(i, i + 1 + offset)], [])));
  return {
    $tag: "PlantFamilySpeciesSets", family: whole, genera: sets,
    genusWithinFamily: sets.map((set) => comparison(set, whole, [just(true), just(false), just(false)], set.members)),
    genusComparisons: pairs,
    union: { $tag: "PlantSpeciesSetUnion", members, constraint: { $tag: "SeUnion", branches: [] }, unionWithinFamily: just(true), familyWithinUnion: just(true) },
  };
}

const apiaceaeSets = familyValue();
const asteraceaeSets = decidedFamily(asteraceae, [[helianthus, [sunflower, jerusalemArtichoke]], [arctium, [lesserBurdock]]]);
const solanaceaeSets = decidedFamily(solanaceae, [[solanum, [potato, cutleafNightshade]], [datura, [thornApple]]]);
const lifeFormSet = (tag: string, members: unknown[]) => ({ $tag: "PlantLifeFormSet", lifeForm: { $tag: tag }, members, constraint: enumOf(members) });
const annuals = lifeFormSet("PlantAnnual", [sunflower, cutleafNightshade, thornApple]);
const biennials = lifeFormSet("PlantBiennial", [lesserBurdock]);
const perennials = lifeFormSet("PlantPerennial", [fennel, giant, jerusalemArtichoke, potato]);
const crossing = (family: { family: unknown }, lifeForm: unknown, shared: unknown[], disjoint: unknown = just(shared.length === 0)) => ({
  $tag: "PlantFamilyLifeFormCrossing", family: family.family, lifeForm, shared, familyWithinLifeForm: just(false), disjoint,
});
const allCrossings = [
  crossing(apiaceaeSets, annuals, []), crossing(apiaceaeSets, biennials, []), crossing(apiaceaeSets, perennials, [fennel, giant]),
  crossing(asteraceaeSets, annuals, [sunflower]), crossing(asteraceaeSets, biennials, [lesserBurdock]), crossing(asteraceaeSets, perennials, [jerusalemArtichoke]),
  crossing(solanaceaeSets, annuals, [cutleafNightshade, thornApple]), crossing(solanaceaeSets, biennials, []), crossing(solanaceaeSets, perennials, [potato]),
];
const fullCollection = (overrides: Record<string, unknown> = {}) => ({
  $tag: "PlantSpeciesSetsInCollection", coverage,
  families: just([apiaceaeSets, asteraceaeSets, solanaceaeSets]),
  lifeForms: just([annuals, biennials, perennials]),
  crossings: just(allCrossings),
  ...overrides,
});

function readCollection(value: unknown) {
  const model = readNestedSets(value);
  if (model?.kind !== "collection") throw new Error("Expected a collection");
  return model;
}

function tableText(table: CrossingTable | "undecided" | undefined) {
  if (!table || table === "undecided") throw new Error("Expected a crossing table");
  return {
    columns: table.columns.map((column) => column.title),
    rows: table.rows.map((row) => [row.name, ...row.cells.map((cell) => cell ? crossingCellText(cell) : "")]),
  };
}

describe("readNestedSets: several families and the sets that cut across them", () => {
  test("three family boxes, each genus box with its species, the summary lines per family", () => {
    const model = readCollection(fullCollection());
    expect(model.families!.map(familyTitle)).toEqual(["Apiaceae · carrot family", "Asteraceae · daisy family", "Solanaceae · nightshade family"]);
    expect(model.families!.map((family) => family.countText)).toEqual(["2 species", "3 species", "3 species"]);
    expect(model.families![1]!.genera.map((genus) => [genus.name, genus.countText, genus.verdict, genus.species.map((row) => row.common)])).toEqual([
      ["Helianthus", "2 species", "true", ["Sunflower", "Jerusalem artichoke"]],
      ["Arctium", "1 species", "true", ["Lesser burdock"]],
    ]);
    for (const family of model.families!) {
      expect(family.relations.map(relationText)).toEqual(["The 2 genus sets are pairwise disjoint", `Their union is ${family.name}`]);
    }
    expect(nestedSetsInlineText(model)).toBe("Apiaceae ⊇ Foeniculum, Ferula; Asteraceae ⊇ Helianthus, Arctium; Solanaceae ⊇ Solanum, Datura");
  });

  test("pairwise disjoint is stated only when every pair is Just true; other pairs are listed, missing pairs never summarised", () => {
    const daucus = plantGenus("Daucus", { $tag: "PlantFamily", scientificName: "Apiaceae", commonNames: ["carrot family"], source: "" });
    const carrot = plant("Daucus carota", "carrot", daucus, "PlantBiennial");
    const genera: Array<[unknown, unknown[]]> = [[foeniculum, [fennel]], [ferula, [giant]], [daucus, [carrot]]];
    const relationsOf = (value: unknown) => {
      const model = readNestedSets(value);
      if (model?.kind !== "family") throw new Error("Expected one family");
      return model.family.relations.map(relationText);
    };
    expect(relationsOf(decidedFamily(apiaceae, genera))).toEqual(["The 3 genus sets are pairwise disjoint", "Their union is Apiaceae"]);
    const oneUndecided = decidedFamily(apiaceae, genera, (first, second) => first === 1 && second === 2 ? nothing : just(true));
    expect(relationsOf(oneUndecided)).toEqual(["Ferula ∩ Daucus: not decided", "Their union is Apiaceae"]);
    const oneMeets = decidedFamily(apiaceae, genera, (first) => first === 0 ? just(false) : just(true));
    expect(relationsOf(oneMeets)).toEqual(["Foeniculum ∩ Ferula ≠ ∅", "Foeniculum ∩ Daucus ≠ ∅", "Their union is Apiaceae"]);
    const complete = decidedFamily(apiaceae, genera);
    expect(relationsOf({ ...complete, genusComparisons: complete.genusComparisons.slice(1) })).toEqual(["Their union is Apiaceae"]);
    const unionOnlyWithin = { ...complete, union: { members: [], unionWithinFamily: just(true), familyWithinUnion: just(false) } };
    expect(relationsOf(unionOnlyWithin)).toEqual(["The 3 genus sets are pairwise disjoint", "Their union is a subset of Apiaceae"]);
  });

  test("life-form sets read as titled boxes with counts and chips", () => {
    const model = readCollection(fullCollection());
    const sets = model.lifeForms as readonly LifeFormSet[];
    expect(sets.map((set) => [set.key, set.title, set.countText, set.species.map((row) => row.common)])).toEqual([
      ["PlantAnnual", "Annuals", "3 species", ["Sunflower", "Cutleaf nightshade", "Thorn apple"]],
      ["PlantBiennial", "Biennials", "1 species", ["Lesser burdock"]],
      ["PlantPerennial", "Perennials", "4 species", ["Fennel", "Giant fennel", "Jerusalem artichoke", "Potato"]],
    ]);
    expect([lifeFormTitle("PlantAnnual"), lifeFormTitle("PlantBiennial"), lifeFormTitle("PlantPerennial"), lifeFormTitle("toString")])
      .toEqual(["Annuals", "Biennials", "Perennials", undefined]);
  });

  test("the crossing table: families as rows, life forms as columns, ∅ only for a decided empty intersection", () => {
    expect(tableText(readCollection(fullCollection()).crossings)).toEqual({
      columns: ["Annuals", "Biennials", "Perennials"],
      rows: [
        ["Apiaceae", "∅", "∅", "Fennel, Giant fennel"],
        ["Asteraceae", "Sunflower", "Lesser burdock", "Jerusalem artichoke"],
        ["Solanaceae", "Cutleaf nightshade, Thorn apple", "∅", "Potato"],
      ],
    });
    const mixed = [
      crossing(apiaceaeSets, annuals, [], nothing),
      crossing(apiaceaeSets, biennials, [], just(false)),
      crossing(asteraceaeSets, perennials, [jerusalemArtichoke], nothing),
    ];
    expect(tableText(readCollection(fullCollection({ crossings: just(mixed) })).crossings)).toEqual({
      columns: ["Annuals", "Biennials", "Perennials"],
      rows: [["Apiaceae", "not decided", "≠ ∅", ""], ["Asteraceae", "", "", "not decided"]],
    });
  });

  test("Nothing stays not decided; absent fields add no section; unknown shapes fall back", () => {
    const undecided = readCollection(fullCollection({ lifeForms: nothing, crossings: nothing }));
    expect([undecided.lifeForms, undecided.crossings]).toEqual(["undecided", "undecided"]);
    expect(undecided.families).toHaveLength(3);
    const older = readCollection({ $tag: "PlantSpeciesSetsInCollection", coverage, families: just([apiaceaeSets]) });
    expect("lifeForms" in older || "crossings" in older).toBe(false);
    expect(tableText(readCollection(fullCollection({ crossings: just([]) })).crossings)).toEqual({ columns: ["Annuals", "Biennials", "Perennials"], rows: [] });
    expect(readNestedSets(fullCollection({ lifeForms: just([lifeFormSet("PlantShrub", [potato])]) }))).toBeUndefined();
    expect(readNestedSets(fullCollection({ lifeForms: [annuals] }))).toBeUndefined();
    expect(readNestedSets(fullCollection({ crossings: just([{ ...allCrossings[0], disjoint: true }]) }))).toBeUndefined();
    expect(readNestedSets(fullCollection({ crossings: just([{ ...allCrossings[0], shared: [{ scientificName: 3 }] }]) }))).toBeUndefined();
  });
});

describe("sets by name: beside the life forms, with only the answers the picture cannot give", () => {
  const daucus = plantGenus("Daucus", apiaceae);
  const carrot = plant("Daucus carota", "carrot", daucus, "PlantBiennial");
  const apiaceaeWithCarrot = speciesSet({ $tag: "TaxonFamily", _0: apiaceae }, [fennel, giant, carrot]);
  const fennels = { $tag: "PlantNamedSpeciesSet", name: "Fennels", calledBy: "fennel", meaning: "", members: [fennel, giant], constraint: enumOf([fennel, giant]) };
  const meet = (taxon: unknown, within: unknown, others: unknown[] = []) => ({ $tag: "PlantNamedSetTaxonComparison", named: fennels, taxon,
    namedWithinTaxon: within, disjoint: just(false), shared: [], onlyTaxon: others });
  const placement = (meets: unknown[], named: unknown = fennels) => ({ $tag: "PlantNamedSetPlacement", named, meets });
  const namedOf = (value: unknown) => {
    const named = readCollection(fullCollection({ namedSets: value })).namedSets;
    if (!Array.isArray(named)) throw new Error("Expected decided sets by name");
    return named as readonly NamedSet[];
  };
  const written = (set: NamedSet) => set.answers.filter((answer) => namedAnswerNeedsWords(answer, set.answers)).map(namedAnswerText);

  test("the fennels: two species, within Apiaceae with the others named, not within either genus", () => {
    const [set, ...rest] = namedOf(just([placement([meet(apiaceaeWithCarrot, just(true), [carrot]), meet(foeniculumSet, just(false)), meet(ferulaSet, just(false))])]));
    expect(rest).toEqual([]);
    expect([set!.name, set!.countText, set!.species.map((row) => row.common)]).toEqual(["Fennels", "2 species", ["Fennel", "Giant fennel"]]);
    expect(set!.answers.map((answer) => [answer.taxon, answer.family, answer.verdict])).toEqual([
      ["Apiaceae", undefined, "true"], ["Foeniculum", "Apiaceae", "false"], ["Ferula", "Apiaceae", "false"],
    ]);
    expect(written(set!)).toEqual(["Within Apiaceae, which also holds Carrot", "Not within Foeniculum", "Not within Ferula"]);
  });

  test("within a genus, the family answer is left to the drawing; undecided and equal answers are written", () => {
    const [inGenus] = namedOf(just([placement([meet(familySet, just(true), [giant]), meet(foeniculumSet, just(true))],
      { ...fennels, members: [fennel], constraint: enumOf([fennel]) })]));
    expect(written(inGenus!)).toEqual(["The same species as Foeniculum"]);
    const [undecided] = namedOf(just([placement([meet(familySet, nothing)])]));
    expect(written(undecided!)).toEqual(["Within Apiaceae: not decided"]);
  });

  test("Nothing stays not decided; absent adds nothing; an unknown shape falls back; the other answers stay unchanged", () => {
    expect(readCollection(fullCollection({ namedSets: nothing })).namedSets).toBe("undecided");
    expect("namedSets" in readCollection(fullCollection())).toBe(false);
    expect(readNestedSets(fullCollection({ namedSets: just([placement([meet(familySet, true)])]) }))).toBeUndefined();
    expect(readNestedSets(fullCollection({ namedSets: just([{ named: { name: 3 }, meets: [] }]) }))).toBeUndefined();
    expect(readCollection(fullCollection({ namedSets: just([]) })).namedSets).toEqual([]);
    // The family and genus relations and verdicts keep their own rules.
    expect(relationNeedsWords({ kind: "pairwise-disjoint", terms: [] })).toBe(false);
    expect(verdictNeedsWords("true")).toBe(false);
  });
});
