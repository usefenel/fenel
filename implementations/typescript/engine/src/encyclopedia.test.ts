// C1: execute the Encyclopedia's actual Fenel source with the existing country
// rows and set judgments. The fixture natives are EncyclopediaDemo's real A2
// source-reflection and B3 type-envelope bridges; no set, row or picture is
// computed in TypeScript here.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry, type ModuleRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { dispatchRegistry } from "./system-entities";
import { countries } from "./reference-data";
import { setExprAsType } from "./type-foundation";
import { peelSetExpr } from "./set-marker";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import type { FenelType, SetExpr } from "./types";

const root = new URL("../../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const ENCYCLOPEDIA_FILES = ["plants.fenel", "illustrations-data.fenel", "emoji.fenel", "emoji-data.fenel", "countries.fenel", "alphabets.fenel", "languages.fenel", "encyclopedia.fenel",
  "life.fenel", "life-data.fenel", "foods.fenel", "foods-data.fenel", "life-pictures.fenel", "life-sprites.fenel", "food-pictures.fenel", "food-sprites.fenel"];

type Flagged = { flag: string; code: string; name: string; currency: string };
type CountryComparison = { both: Flagged[]; onlyLeft: Flagged[]; onlyRight: Flagged[]; count: number;
  leftWithinRight: unknown; rightWithinLeft: unknown; disjoint: unknown; bothType: FenelType };
type Emoji = { $tag?: string; emoji: string; name: string; group: string; subgroup: string; codepoints: string; since: string };
type EmojiSet = { name: string; origin: { $tag: string }; members: Emoji[]; count: number; constraint: SetExpr; emojiType: FenelType };
type EmojiComparison = { shared: Emoji[]; leftWithinRight: unknown; rightWithinLeft: unknown; disjoint: unknown };
type Family = { $tag: string; scientificName: string };
type Genus = { $tag: string; scientificName: string; family: Family };
type Species = { $tag: string; scientificName: string; authority: string; genus: Genus; commonNames: string[]; lifeForm: { $tag: string };
  nativeRange: string; source: string };
type Illustration = { image: { width: number; height: number; pixels: Array<{ r: number; g: number; b: number; a: number }> };
  subject: { $tag: string; _0: { scientificName: string } }; credit: { caption: string; depicts: string; licence: string } };

type Kana = { $tag: string; kana: string; reading: string; order: number; vowel: boolean; script: { $tag: string };
  codepoint: string; unicodeName: string; source: string };
type Language = { $tag: string; name: string; firstAppeared: number; fenelTakes: string; source: string };

let registry: ModuleRegistry;
let context: EvaluateContext;
let encyclopediaModule: ReturnType<typeof loadFenelModuleUnion>[number];
const just = (value: unknown) => ({ $tag: "Just", _0: value });
/** A record type's fields in the order its declaration writes them. A tile reads the first field large and
 *  the second in the corner from this declared order; a value's own key order is not the declaration's. */
function declaredFields(type: string): string[] {
  const entities = encyclopediaModule.entities as unknown as Array<{ id: string; type: { $record?: { fields: Array<{ name: string }> } } }>;
  return entities.find(entity => entity.id === type)?.type.$record?.fields.map(field => field.name) ?? [];
}

function call<T>(name: string, ...args: unknown[]): T {
  return withInterpretedResolver(() => invokeCallable({ $ref: `Encyclopedia:${name}` }, args, context)) as T;
}

beforeAll(() => withInterpretedResolver(() => {
  const countryDemo = { ...loadFenelModule(source("fenel/modules/publicdemo/encyclopedia-demo.fenel"), "EncyclopediaDemo"), nativeImpls: {
    "EncyclopediaDemo:encyclopediaSourceCountries": () => countries,
    "EncyclopediaDemo:encyclopediaTypeFromSet": (base: unknown, constraint: unknown) => setExprAsType(base as FenelType, constraint as SetExpr),
  } };
  const greek = loadFenelModule(source("fenel/modules/publicdemo/greek-alphabet-demo.fenel"), "GreekAlphabetDemo");
  const encyclopedia = loadFenelModuleUnion(ENCYCLOPEDIA_FILES.map(name => ({ src: source(`fenel/modules/encyclopedia/${name}`), name })),
    { labels: { Encyclopedia: "Encyclopedia" } })[0]!;
  encyclopediaModule = encyclopedia;
  registry = createRegistry([stdModule, decidableMembershipModule, countryDemo, greek, encyclopedia], { dispatchRegistry });
  context = registry.evaluateContext();
}), 900_000);

describe("living things: three families, ten genera, twelve species", () => {
  test("each species names its genus and each genus the shared family", () => {
    const fennel = call<Species>("commonFennel");
    const giant = call<Species>("giantFennel");
    expect([fennel.scientificName, fennel.authority, fennel.genus.scientificName, fennel.genus.family.scientificName])
      .toEqual(["Foeniculum vulgare", "Mill.", "Foeniculum", "Apiaceae"]);
    expect([giant.scientificName, giant.authority, giant.genus.scientificName, giant.genus.family.scientificName])
      .toEqual(["Ferula communis", "L.", "Ferula", "Apiaceae"]);
    expect(fennel.genus.scientificName).not.toBe(giant.genus.scientificName);
    expect([fennel.lifeForm.$tag, giant.lifeForm.$tag]).toEqual(["PlantPerennial", "PlantPerennial"]);
    expect(fennel.source).toBe("https://powo.science.kew.org/taxon/842680-1");
  });

  test("the added species keep their checked authority, genus, family and life form", () => {
    const rows = ["carrot", "celery", "coriander", "dill", "sunflower", "jerusalemArtichoke", "lesserBurdock", "potato", "cutleafNightshade", "thornApple"]
      .map(name => call<Species>(name))
      .map(row => [row.scientificName, row.authority, row.genus.scientificName, row.genus.family.scientificName, row.lifeForm.$tag]);
    expect(rows).toEqual([
      ["Daucus carota", "L.", "Daucus", "Apiaceae", "PlantBiennial"],
      ["Apium graveolens", "L.", "Apium", "Apiaceae", "PlantBiennial"],
      ["Coriandrum sativum", "L.", "Coriandrum", "Apiaceae", "PlantAnnual"],
      ["Anethum graveolens", "L.", "Anethum", "Apiaceae", "PlantAnnual"],
      ["Helianthus annuus", "L.", "Helianthus", "Asteraceae", "PlantAnnual"],
      ["Helianthus tuberosus", "L.", "Helianthus", "Asteraceae", "PlantPerennial"],
      ["Arctium minus", "(Hill) Bernh.", "Arctium", "Asteraceae", "PlantBiennial"],
      ["Solanum tuberosum", "L.", "Solanum", "Solanaceae", "PlantPerennial"],
      ["Solanum triflorum", "Nutt.", "Solanum", "Solanaceae", "PlantAnnual"],
      ["Datura stramonium", "L.", "Datura", "Solanaceae", "PlantAnnual"],
    ]);
  });

  test("plates are bounded Images that point at the taxon they show; plants carry no pixels", () => {
    const plate = call<Illustration>("foeniculumVulgareIllustration");
    expect(plate.image.width).toBe(72);
    expect(plate.image.pixels).toHaveLength(72 * plate.image.height);
    expect([plate.subject.$tag, plate.subject._0.scientificName]).toEqual(["TaxonSpecies", "Foeniculum vulgare"]);
    expect(plate.credit.licence).toBe("Public domain");
    const narthex = call<Illustration>("narthexAsafoetidaIllustration");
    expect([narthex.subject.$tag, narthex.subject._0.scientificName]).toEqual(["TaxonGenus", "Ferula"]);
    expect(narthex.credit.caption).toContain("Narthex asafoetida Falconer");
    expect(narthex.credit.depicts).toContain("Ferula narthex Boiss.");
    expect(narthex.image.pixels).toHaveLength(72 * narthex.image.height);
    expect(JSON.stringify(call<Species>("giantFennel"))).not.toContain("pixels");
    for (const pixel of narthex.image.pixels.slice(0, 200)) {
      expect(pixel.a).toBe(255);
      for (const channel of [pixel.r, pixel.g, pixel.b]) expect(channel >= 0 && channel <= 255 && Number.isInteger(channel)).toBe(true);
    }
  });
});

describe("country sets", () => {
  test("the euro area is the intersection of euro users and EU member states, Bulgaria included", () => {
    const value = call<CountryComparison>("euroAndEuCountries");
    expect(value.both.map(row => row.code).sort()).toEqual(["AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR",
      "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);
    expect(value.count).toBe(21);
    expect(value.onlyLeft.map(row => row.code).sort()).toEqual(["AD", "GF", "GP", "MC", "ME", "MQ", "RE", "SM", "VA", "XK", "YT"]);
    expect(value.onlyRight.map(row => row.code).sort()).toEqual(["CZ", "DK", "HU", "PL", "RO", "SE"]);
    expect([value.leftWithinRight, value.rightWithinLeft, value.disjoint]).toEqual([just(false), just(false), just(false)]);
    expect(value.both.find(row => row.code === "FR")).toEqual(expect.objectContaining({ flag: "🇫🇷", name: "France", currency: "EUR" }));
  });

  test("their flags are a subset of Unicode's country flags", () => {
    const flags = call<EmojiSet>("euroAreaFlagEmoji");
    expect(flags.count).toBe(21);
    expect(flags.origin.$tag).toBe("FlagsOfCountrySet");
    const inside = call<EmojiComparison>("euroAreaFlagsWithinCountryFlags");
    expect(inside.leftWithinRight).toEqual(just(true));
    expect(inside.shared).toHaveLength(21);
  });
});

describe("emoji sets", () => {
  test("seven official subgroups keep Unicode's rows and counts", () => {
    const counts = Object.fromEntries(["fruitEmoji", "vegetableEmoji", "flowerEmoji", "otherPlantEmoji", "mammalEmoji", "smilingFaceEmoji", "countryFlagEmoji"]
      .map(name => [name, call<EmojiSet>(name).count]));
    expect(counts).toEqual({ fruitEmoji: 20, vegetableEmoji: 19, flowerEmoji: 12, otherPlantEmoji: 17, mammalEmoji: 66, smilingFaceEmoji: 14, countryFlagEmoji: 259 });
    const fruit = call<EmojiSet>("fruitEmoji");
    expect(fruit.origin.$tag).toBe("OfficialEmojiSubgroup");
    expect(fruit.members[0]).toEqual({ $tag: "EmojiCharacter", emoji: "🍇", name: "grapes", group: "Food & Drink", subgroup: "food-fruit", codepoints: "1F347", since: "E0.6" });
    expect(new Set(fruit.members.map(row => row.subgroup))).toEqual(new Set(["food-fruit"]));
  });

  test("a union contains its parts, and two official subgroups never overlap", () => {
    const within = call<EmojiComparison>("fruitWithinPlantFood");
    expect([within.leftWithinRight, within.rightWithinLeft]).toEqual([just(true), just(false)]);
    expect(within.shared).toHaveLength(20);
    const apart = call<EmojiComparison>("fruitAndPlants");
    expect(apart.shared).toEqual([]);
    expect(apart.disjoint).toEqual(just(true));
  });
});

describe("the contents nest each set inside the one that contains it", () => {
  test("families hold genera, genera hold species, groups hold subgroups", () => {
    const contents = call<{ livingThings: { plantFamilies: Array<{ family: Family; genera: Array<{ genus: Genus; species: Species[]; plates: Illustration[] }> }> };
      emoji: { groups: Array<{ group: string; subgroups: EmojiSet[] }> }; countries: { countries: unknown[] };
      writing: { greekSets: Array<{ glyphs: string[]; count: number }>; hiragana: Kana[]; katakana: Kana[] };
      programmingLanguages: Language[] }>("encyclopedia");
    const families = contents.livingThings.plantFamilies;
    expect(families.map(entry => entry.family.scientificName)).toEqual(["Apiaceae", "Asteraceae", "Solanaceae"]);
    expect(families.map(entry => entry.genera.map(genus => [genus.genus.scientificName, genus.species.map(row => row.scientificName)]))).toEqual([
      [["Foeniculum", ["Foeniculum vulgare"]], ["Ferula", ["Ferula communis"]], ["Daucus", ["Daucus carota"]],
        ["Apium", ["Apium graveolens"]], ["Coriandrum", ["Coriandrum sativum"]], ["Anethum", ["Anethum graveolens"]]],
      [["Helianthus", ["Helianthus annuus", "Helianthus tuberosus"]], ["Arctium", ["Arctium minus"]]],
      [["Solanum", ["Solanum tuberosum", "Solanum triflorum"]], ["Datura", ["Datura stramonium"]]],
    ]);
    for (const family of families) for (const entry of family.genera) {
      expect(entry.genus.family).toEqual(family.family);
      for (const species of entry.species) expect(species.genus).toEqual(entry.genus);
    }
    const [apiaceae] = families;
    expect(apiaceae!.genera.map(entry => entry.plates.map(plate => plate.subject.$tag))).toEqual([["TaxonSpecies"], ["TaxonGenus"], [], [], [], []]);
    expect(families.slice(1).flatMap(family => family.genera.flatMap(entry => entry.plates))).toEqual([]);
    for (const group of contents.emoji.groups) for (const set of group.subgroups) {
      expect(new Set(set.members.map(row => row.group))).toEqual(new Set([group.group]));
    }
    expect(contents.countries.countries).toHaveLength(countries.length);
    expect(contents.writing.greekSets.map(result => result.count)).toEqual([7, 35, 0]);
    expect(contents.writing.hiragana).toEqual(call<Kana[]>("hiragana"));
    expect(declaredFields("EncyclopediaWriting")).toEqual(["greekAlphabet", "greekCharacters", "greekSets", "latinAlphabet", "russianAlphabet", "elderFuthark", "hiragana", "katakana"]);
    expect(Object.keys(contents.writing).filter(key => key !== "$tag").sort()).toEqual([...declaredFields("EncyclopediaWriting")].sort());
    expect(contents.writing.katakana).toEqual(call<Kana[]>("katakana"));
    expect(contents.programmingLanguages).toEqual(call<Language[]>("programmingLanguages"));
  });
});

describe("kana: the 46 basic hiragana and katakana", () => {
  const HIRAGANA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
  const KATAKANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
  const READINGS = ("a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho "
    + "ma mi mu me mo ya yu yo ra ri ru re ro wa wo n").split(" ");

  test("each table lists the gojūon in order with its Hepburn reading, kana first and reading second", () => {
    for (const [name, glyphs, script, word] of [["hiragana", HIRAGANA, "HiraganaScript", "HIRAGANA"], ["katakana", KATAKANA, "KatakanaScript", "KATAKANA"]] as const) {
      const rows = call<Kana[]>(name);
      expect(rows).toHaveLength(46);
      expect(rows.map(row => row.kana).join("")).toBe(glyphs);
      expect(rows.map(row => row.reading)).toEqual(READINGS);
      expect(rows.map(row => row.order)).toEqual(READINGS.map((_, index) => index + 1));
      expect(rows.filter(row => row.vowel).map(row => row.reading)).toEqual(["a", "i", "u", "e", "o"]);
      expect(new Set(rows.map(row => row.script.$tag))).toEqual(new Set([script]));
      // The tile reads the first field large and the second in the corner.
      expect(declaredFields("KanaCharacter").slice(0, 2)).toEqual(["kana", "reading"]);
      for (const row of rows) {
        expect(row.codepoint).toBe(`U+${row.kana.codePointAt(0)!.toString(16).toUpperCase()}`);
        expect(row.unicodeName.startsWith(`${word} LETTER `)).toBe(true);
      }
    }
    const hiragana = call<Kana[]>("hiragana");
    const katakana = call<Kana[]>("katakana");
    katakana.forEach((row, index) => expect(row.kana.codePointAt(0)).toBe(hiragana[index]!.kana.codePointAt(0)! + 0x60));
    expect(["shi", "chi", "tsu", "fu", "wo", "n"].map(reading => hiragana.find(row => row.reading === reading)!.unicodeName))
      .toEqual(["HIRAGANA LETTER SI", "HIRAGANA LETTER TI", "HIRAGANA LETTER TU", "HIRAGANA LETTER HU", "HIRAGANA LETTER WO", "HIRAGANA LETTER N"]);
  });
});

describe("Latin, Russian and runic alphabets", () => {
  type Letter = { $tag: string; capital: string; small: string; order: number; capitalCode: string; smallCode: string; transliteration?: string };
  type Rune = { $tag: string; rune: string; transliteration: string; name: string; order: number; codepoint: string; unicodeName: string; source: string };
  const code = (glyph: string) => `U+${glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  const firstTwo = (type: string) => declaredFields(type).slice(0, 2);

  test("26 Latin letters and the 33 Russian letters, capital first and small letter second", () => {
    const latin = call<Letter[]>("latinAlphabet");
    expect(latin.map(row => row.capital).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const russian = call<Letter[]>("russianAlphabet");
    expect(russian.map(row => row.capital).join("")).toBe("АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ");
    expect(russian.map(row => row.transliteration)).toEqual(("a b v g d ye yë zh z i y k l m n o p r s t u f kh ts ch sh shch ˮ y ʼ e yu ya").split(" "));
    expect(firstTwo("LatinLetter")).toEqual(["capital", "small"]);
    expect(firstTwo("CyrillicLetter")).toEqual(["capital", "small"]);
    for (const rows of [latin, russian]) rows.forEach((row, index) => {
      expect(row.small).toBe(row.capital.toLowerCase());
      expect(row.order).toBe(index + 1);
      expect([row.capitalCode, row.smallCode]).toEqual([code(row.capital), code(row.small)]);
    });
    expect(russian.find(row => row.capital === "Ё")!.smallCode).toBe("U+0451");
  });

  test("the 24 Elder Futhark runes in the Kylver stone order, rune first and transliteration second", () => {
    const runes = call<Rune[]>("elderFuthark");
    expect(runes.map(row => row.rune).join("")).toBe("ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ");
    expect(runes.map(row => row.transliteration).join(" ")).toBe("f u þ a r k g w h n i j ï p z s t b e m l ŋ d o");
    expect(runes.slice(-2).map(row => row.name)).toEqual(["dagaz", "ōþala"]);
    expect(firstTwo("ElderFutharkRune")).toEqual(["rune", "transliteration"]);
    runes.forEach((row, index) => {
      expect(row.order).toBe(index + 1);
      expect(row.codepoint).toBe(code(row.rune));
      expect(row.codepoint >= "U+16A0" && row.codepoint <= "U+16F8").toBe(true);
      expect(row.unicodeName.startsWith("RUNIC LETTER ")).toBe(true);
    });
    expect(runes[0]!.unicodeName).toBe("RUNIC LETTER FEHU FEOH FE F");
  });
});

describe("programming languages", () => {
  test("ten languages in the order they first appeared, each with what Fenel takes from it and a source", () => {
    const rows = call<Language[]>("programmingLanguages");
    expect(rows.map(row => [row.name, row.firstAppeared])).toEqual([
      ["LISP", 1960], ["Smalltalk", 1972], ["Prolog", 1972], ["SQL", 1973], ["Erlang", 1986], ["Coq", 1989],
      ["Haskell", 1990], ["OCaml", 1996], ["Scratch", 2003], ["TypeScript", 2012],
    ]);
    expect(declaredFields("ProgrammingLanguage").slice(0, 2)).toEqual(["name", "firstAppeared"]);
    for (const row of rows) {
      expect(row.$tag).toBe("ProgrammingLanguage");
      expect(row.fenelTakes.length).toBeGreaterThan(0);
      expect(row.source.startsWith("https://en.wikipedia.org/wiki/")).toBe(true);
    }
    expect(rows[5]).toEqual(call<Language>("languageCoq"));
    expect(rows[3]).toEqual(call<Language>("languageSql"));
  });
});

describe("species sets in this finite collection", () => {
  type DescribedFamily = { family: Family; genera: Array<{ genus: Genus; species: Species[]; plates: Illustration[] }> };
  type Maybe<T> = { $tag: "Nothing" } | { $tag: "Just"; _0: T };
  type SpeciesSet = { taxon: { $tag: string; _0: Family | Genus }; members: Species[]; constraint: SetExpr };
  type Comparison = { first: SpeciesSet; second: SpeciesSet; firstWithinSecond: unknown; secondWithinFirst: unknown;
    disjoint: unknown; shared: Species[]; onlyFirst: Species[]; onlySecond: Species[] };
  type FamilySets = { family: SpeciesSet; genera: SpeciesSet[]; genusWithinFamily: Comparison[]; genusComparisons: Comparison[];
    union: { members: Species[]; constraint: SetExpr; unionWithinFamily: unknown; familyWithinUnion: unknown } };
  type LifeFormSet = { lifeForm: { $tag: string }; members: Species[]; constraint: SetExpr };
  type Crossing = { family: SpeciesSet; lifeForm: LifeFormSet; shared: Species[]; familyWithinLifeForm: unknown; disjoint: unknown };
  type NamedSet = { name: string; calledBy: string; meaning: string; members: Species[]; constraint: SetExpr };
  type NamedComparison = { named: NamedSet; taxon: SpeciesSet; namedWithinTaxon: unknown; disjoint: unknown; shared: Species[]; onlyTaxon: Species[] };
  type Placement = { named: NamedSet; meets: NamedComparison[] };
  type SpeciesSets = { coverage: string; families: Maybe<FamilySets[]>; lifeForms: Maybe<LifeFormSet[]>; crossings: Maybe<Crossing[]>;
    namedSets: Maybe<Placement[]> };

  // Every species in collection order (family by family, genus by genus).
  const COLLECTION = ["commonFennel", "giantFennel", "carrot", "celery", "coriander", "dill",
    "sunflower", "jerusalemArtichoke", "lesserBurdock", "potato", "cutleafNightshade", "thornApple"];

  function decidedValue<T>(value: Maybe<T>): T {
    expect(value.$tag).toBe("Just");
    if (value.$tag !== "Just") throw new Error("Species selection is undecided.");
    return value._0;
  }

  function decided(value: SpeciesSets): FamilySets[] {
    expect(value.coverage).toBe("These sets contain the species described in this collection. Other species are not listed here.");
    return decidedValue(value.families);
  }

  const species = (...names: string[]) => names.map(name => call<Species>(name));
  const scientific = (rows: Species[]) => rows.map(row => row.scientificName);
  const taxonName = (set: SpeciesSet) => set.taxon._0.scientificName;
  const living = () => call<{ plantFamilies: DescribedFamily[]; speciesSets: SpeciesSets }>("encyclopediaLivingThings");

  function membership(constraint: SetExpr, row: Species): unknown {
    return withInterpretedResolver(() => invokeCallable({ $ref: "set:contains" }, [constraint, row], context));
  }

  test("each family set holds its species; its genus sets are proper subsets, pairwise disjoint, and their union is the family", () => {
    const value = living();
    const families = decided(value.speciesSets);
    expect(families.map(family => taxonName(family.family))).toEqual(["Apiaceae", "Asteraceae", "Solanaceae"]);
    expect(families.map(family => family.family.members)).toEqual([
      species("commonFennel", "giantFennel", "carrot", "celery", "coriander", "dill"),
      species("sunflower", "jerusalemArtichoke", "lesserBurdock"),
      species("potato", "cutleafNightshade", "thornApple"),
    ]);
    expect(families.map(family => family.genera.map(genus => [taxonName(genus), scientific(genus.members)]))).toEqual([
      [["Foeniculum", ["Foeniculum vulgare"]], ["Ferula", ["Ferula communis"]], ["Daucus", ["Daucus carota"]],
        ["Apium", ["Apium graveolens"]], ["Coriandrum", ["Coriandrum sativum"]], ["Anethum", ["Anethum graveolens"]]],
      [["Helianthus", ["Helianthus annuus", "Helianthus tuberosus"]], ["Arctium", ["Arctium minus"]]],
      [["Solanum", ["Solanum tuberosum", "Solanum triflorum"]], ["Datura", ["Datura stramonium"]]],
    ]);
    expect(families.flatMap(family => family.family.members))
      .toEqual(value.plantFamilies.flatMap(entry => entry.genera.flatMap(genus => genus.species)));
    for (const family of families) {
      const whole = family.family.members;
      expect(family.genusWithinFamily).toHaveLength(family.genera.length);
      family.genusWithinFamily.forEach((comparison, index) => {
        const genus = family.genera[index]!;
        expect([comparison.first, comparison.second]).toEqual([genus, family.family]);
        expect([comparison.firstWithinSecond, comparison.secondWithinFirst, comparison.disjoint])
          .toEqual([just(true), just(false), just(false)]);
        expect(comparison.shared).toEqual(genus.members);
        expect(comparison.onlyFirst).toEqual([]);
        expect(comparison.onlySecond).toEqual(whole.filter(row => !scientific(genus.members).includes(row.scientificName)));
      });
      const count = family.genera.length;
      expect(family.genusComparisons).toHaveLength(count * (count - 1) / 2);
      for (const pair of family.genusComparisons) {
        expect([pair.firstWithinSecond, pair.secondWithinFirst, pair.disjoint]).toEqual([just(false), just(false), just(true)]);
        expect([pair.shared, pair.onlyFirst, pair.onlySecond]).toEqual([[], pair.first.members, pair.second.members]);
      }
      expect(family.union.members).toEqual(whole);
      expect([family.union.unionWithinFamily, family.union.familyWithinUnion]).toEqual([just(true), just(true)]);
      expect(peelSetExpr(family.union.constraint)).toHaveProperty("kind", "SeUnion");
      for (const row of whole) expect(membership(family.union.constraint, row)).toEqual(just(true));
    }
    expect(families[0]!.genusComparisons.slice(0, 2).map(pair => [taxonName(pair.first), taxonName(pair.second)]))
      .toEqual([["Foeniculum", "Ferula"], ["Foeniculum", "Daucus"]]);
    expect(families[1]!.genusComparisons.map(pair => [taxonName(pair.first), taxonName(pair.second)])).toEqual([["Helianthus", "Arctium"]]);
    expect(families[2]!.genusComparisons.map(pair => [taxonName(pair.first), taxonName(pair.second)])).toEqual([["Solanum", "Datura"]]);
    expect(membership(families[1]!.family.constraint, call<Species>("potato"))).toEqual(just(false));
  });

  test("the life-form sets cut across families: annual, biennial and perennial", () => {
    const value = living();
    const sets = decidedValue(value.speciesSets.lifeForms);
    expect(sets.map(set => set.lifeForm.$tag)).toEqual(["PlantAnnual", "PlantBiennial", "PlantPerennial"]);
    expect(sets.map(set => set.members)).toEqual([
      species("coriander", "dill", "sunflower", "cutleafNightshade", "thornApple"),
      species("carrot", "celery", "lesserBurdock"),
      species("commonFennel", "giantFennel", "jerusalemArtichoke", "potato"),
    ]);
    expect(sets.map(set => new Set(set.members.map(row => row.genus.family.scientificName)).size)).toEqual([3, 2, 3]);
    const all = species(...COLLECTION);
    for (const set of sets) {
      for (const row of set.members) expect(row.lifeForm.$tag).toBe(set.lifeForm.$tag);
      for (const row of all) expect(membership(set.constraint, row)).toEqual(just(row.lifeForm.$tag === set.lifeForm.$tag));
    }
    expect(sets.flatMap(set => scientific(set.members)).sort()).toEqual(scientific(all).sort());
    const sunflower = call<Species>("sunflower");
    expect(call<unknown>("encyclopediaSpeciesLifeFormContains", { $tag: "PlantAnnual" }, sunflower)).toEqual(just(true));
    expect(call<unknown>("encyclopediaSpeciesLifeFormContains", { $tag: "PlantPerennial" }, sunflower)).toEqual(just(false));
  });

  test("each family crossed with each life form: nine intersections, one of them empty", () => {
    const value = living();
    const families = decided(value.speciesSets);
    const lifeForms = decidedValue(value.speciesSets.lifeForms);
    const crossings = decidedValue(value.speciesSets.crossings);
    expect(crossings).toHaveLength(9);
    expect(crossings.map(crossing => [taxonName(crossing.family), crossing.lifeForm.lifeForm.$tag, scientific(crossing.shared)])).toEqual([
      ["Apiaceae", "PlantAnnual", ["Coriandrum sativum", "Anethum graveolens"]],
      ["Apiaceae", "PlantBiennial", ["Daucus carota", "Apium graveolens"]],
      ["Apiaceae", "PlantPerennial", ["Foeniculum vulgare", "Ferula communis"]],
      ["Asteraceae", "PlantAnnual", ["Helianthus annuus"]],
      ["Asteraceae", "PlantBiennial", ["Arctium minus"]],
      ["Asteraceae", "PlantPerennial", ["Helianthus tuberosus"]],
      ["Solanaceae", "PlantAnnual", ["Solanum triflorum", "Datura stramonium"]],
      ["Solanaceae", "PlantBiennial", []],
      ["Solanaceae", "PlantPerennial", ["Solanum tuberosum"]],
    ]);
    crossings.forEach((crossing, index) => {
      expect(crossing.family).toEqual(families[Math.floor(index / 3)]!.family);
      expect(crossing.lifeForm).toEqual(lifeForms[index % 3]!);
      expect(crossing.familyWithinLifeForm).toEqual(just(false));
      expect(crossing.disjoint).toEqual(just(crossing.shared.length === 0));
      for (const row of crossing.shared) {
        expect(membership(crossing.family.constraint, row)).toEqual(just(true));
        expect(membership(crossing.lifeForm.constraint, row)).toEqual(just(true));
      }
    });
    const empty = crossings[7]!;
    expect([empty.shared, empty.disjoint]).toEqual([[], just(true)]);
    expect(crossings[6]!.shared).toEqual(species("cutleafNightshade", "thornApple"));
  });

  test("the fennels are a set made by people: both fennels, no genus of their own, and Apiaceae holds carrot too", () => {
    const value = living();
    const [placement, ...others] = decidedValue(value.speciesSets.namedSets);
    expect(others).toEqual([]);
    const fennels = placement!.named;
    expect([fennels.name, fennels.calledBy]).toEqual(["Fennels", "fennel"]);
    expect(fennels.members).toEqual(species("commonFennel", "giantFennel"));
    expect(call<NamedSet>("encyclopediaFennels")).toEqual(fennels);
    for (const row of species(...COLLECTION)) {
      const isFennel = ["Foeniculum vulgare", "Ferula communis"].includes(row.scientificName);
      expect(membership(fennels.constraint, row)).toEqual(just(isFennel));
      expect(call<boolean>("encyclopediaSpeciesCalled", "fennel", row)).toBe(isFennel);
    }
    // Every botanical set it is not decided disjoint from, in collection order.
    expect(placement!.meets.map(row => [taxonName(row.taxon), row.namedWithinTaxon, row.disjoint, scientific(row.shared), scientific(row.onlyTaxon)])).toEqual([
      ["Apiaceae", just(true), just(false), ["Foeniculum vulgare", "Ferula communis"], ["Daucus carota", "Apium graveolens", "Coriandrum sativum", "Anethum graveolens"]],
      ["Foeniculum", just(false), just(false), ["Foeniculum vulgare"], []],
      ["Ferula", just(false), just(false), ["Ferula communis"], []],
    ]);
    // No genus holds both, and the smallest set that does also holds carrot.
    const containing = placement!.meets.filter(row => JSON.stringify(row.namedWithinTaxon) === JSON.stringify(just(true)));
    expect(containing.map(row => row.taxon.taxon.$tag)).toEqual(["TaxonFamily"]);
    expect(scientific(containing[0]!.onlyTaxon)).toContain("Daucus carota");
    expect(call<boolean>("encyclopediaNameEndsWith", "fennel", "giant fennel")).toBe(true);
    expect(call<boolean>("encyclopediaNameEndsWith", "fennel", "fennel flower")).toBe(false);
  });

  test("membership uses full records rather than matching scientific-name strings", () => {
    const value = living();
    const fennel = call<Species>("commonFennel");
    const [apiaceae, , solanaceae] = decided(value.speciesSets);
    const changed = { ...fennel, authority: "Different authority" };
    expect(changed.scientificName).toBe(fennel.scientificName);
    expect(membership(apiaceae!.family.constraint, changed)).toEqual(just(false));
    const potato = call<Species>("potato");
    expect(membership(solanaceae!.family.constraint, potato)).toEqual(just(true));
    expect(membership(solanaceae!.family.constraint, { ...potato, nativeRange: "Elsewhere" })).toEqual(just(false));
    const [annual] = decidedValue(value.speciesSets.lifeForms);
    const sunflower = call<Species>("sunflower");
    expect(membership(annual!.constraint, sunflower)).toEqual(just(true));
    expect(membership(annual!.constraint, { ...sunflower, commonNames: ["sunflower"] })).toEqual(just(false));
    const otherGenus = { ...fennel.genus, authority: "Different genus authority" };
    expect(call<unknown>("encyclopediaSpeciesTaxonContains", { $tag: "TaxonGenus", _0: otherGenus }, fennel)).toEqual(just(false));
    expect(call<unknown>("encyclopediaSpeciesTaxonContains", { $tag: "TaxonGenus", _0: fennel.genus }, fennel)).toEqual(just(true));
  });

  test("changing the supplied collection recomputes every set and verdict without mutating the original", () => {
    const value = living();
    const before = structuredClone(value.plantFamilies);
    // Only Solanaceae, with thorn apple taken out of Datura.
    const changed = structuredClone(value.plantFamilies.slice(2));
    changed[0]!.genera[1]!.species = [];
    const revisedSets = call<SpeciesSets>("encyclopediaSpeciesSets", changed);
    const [revised] = decided(revisedSets);
    expect(decided(revisedSets)).toHaveLength(1);
    const [potato, nightshade, thornApple] = species("potato", "cutleafNightshade", "thornApple") as [Species, Species, Species];
    expect(revised!.family.members).toEqual([potato, nightshade]);
    expect(revised!.genera.map(set => set.members)).toEqual([[potato, nightshade], []]);
    expect([revised!.genusWithinFamily[0]!.firstWithinSecond, revised!.genusWithinFamily[0]!.secondWithinFirst])
      .toEqual([just(true), just(true)]);
    expect(revised!.union.members).toEqual([potato, nightshade]);
    expect([revised!.union.unionWithinFamily, revised!.union.familyWithinUnion]).toEqual([just(true), just(true)]);
    expect(membership(revised!.family.constraint, thornApple!)).toEqual(just(false));
    expect(revised!.genusComparisons[0]!.disjoint).toEqual(just(true));
    expect(decidedValue(revisedSets.lifeForms).map(set => set.members)).toEqual([[nightshade], [], [potato]]);
    const crossings = decidedValue(revisedSets.crossings);
    expect(crossings.map(crossing => [crossing.shared, crossing.disjoint])).toEqual([
      [[nightshade], just(false)], [[], just(true)], [[potato], just(false)],
    ]);
    const none = call<SpeciesSets>("encyclopediaSpeciesSets", []);
    expect(decided(none)).toEqual([]);
    expect(decidedValue(none.lifeForms).map(set => set.members)).toEqual([[], [], []]);
    expect(decidedValue(none.crossings)).toEqual([]);
    expect(decidedValue(none.namedSets).map(placement => [placement.named.members, placement.meets])).toEqual([[[], []]]);
    // Without the Apiaceae, no species is called fennel and no botanical set is met.
    expect(decidedValue(revisedSets.namedSets).map(placement => [placement.named.members, placement.meets])).toEqual([[[], []]]);
    expect(value.plantFamilies).toEqual(before);
    expect(decided(value.speciesSets).map(family => family.family.members.length)).toEqual([6, 3, 3]);
  });

  test("the public items read the same families: the species sets, the described species and the families", () => {
    const value = living();
    expect(call<DescribedFamily[]>("encyclopediaPlantFamilies")).toEqual(value.plantFamilies);
    expect(call<SpeciesSets>("encyclopediaPlantSpeciesSets")).toEqual(value.speciesSets);
    expect(call<Species[]>("encyclopediaPlantSpecies")).toEqual(species(...COLLECTION));
  });

  test("Viewable selects the nested-sets body for the collection and for each family set", () => {
    const views = (encyclopediaModule.instances ?? []).filter(row => row.typeName === "Viewable");
    // Two for the species sets, two for the tree of life and the foods (encyclopedia-life.test.ts).
    expect(views).toHaveLength(4);
    for (const view of views) {
      expect(Object.keys(view.methods).sort()).toEqual(["defaultInlineView", "defaultView"]);
      expect(JSON.stringify(view.methods).match(/"nested-sets"/g)).toHaveLength(2);
    }
    const args = JSON.stringify(views.map(view => view.args));
    expect(args).toContain("PlantSpeciesSetsInCollection");
    expect(args).toContain("PlantFamilySpeciesSets");
    expect(args).toContain("LifeClassification");
    expect(args).toContain("FoodClassification");
  });
});
