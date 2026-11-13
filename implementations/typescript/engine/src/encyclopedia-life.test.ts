// The tree of life and the foods: execute the
// Encyclopedia's actual Fenel source. Every inclusion and partition below is the set judgment's own verdict; no
// set, row or picture is computed in TypeScript here.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFenelModule, loadFenelModuleUnion } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { decidableMembershipModule } from "./modules/decidable-membership";
import { PUBLIC_DEMO_MODULES } from "./modules/public-demos";
import { dispatchRegistry } from "./system-entities";
import { countries } from "./reference-data";
import { setExprAsType } from "./type-foundation";
import { withInterpretedResolver } from "./engine-bodies-dispatch";
import type { FenelModule, FenelType, SetExpr } from "./types";

const root = new URL("../../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const ENCYCLOPEDIA_FILES = ["plants.fenel", "illustrations-data.fenel", "emoji.fenel", "emoji-data.fenel", "countries.fenel", "alphabets.fenel",
  "languages.fenel", "encyclopedia.fenel", "life.fenel", "life-data.fenel", "foods.fenel", "foods-data.fenel", "life-pictures.fenel",
  "life-sprites.fenel", "food-pictures.fenel", "food-sprites.fenel"];
// Written by the private picture tool; a public checkout skips the hash check (reported as skipped).
const PICTURE_HASHES = "workstreams/recipe-functions/tools/tree-of-life-pictures.hashes.json";

type Tag = { $tag: string };
type Maybe<T> = { $tag: "Nothing" } | { $tag: "Just"; _0: T };
type Facts = { thing: Tag; rank: Tag; scientificName: Maybe<string>; commonNames: string[]; within: Tag[]; source: string };
type Inclusion = { $tag?: string; whole: Tag; within: Maybe<boolean> };
type Partition = { $tag?: string; apart: Maybe<boolean>; cover: Maybe<boolean> };
type LifeSet = { item: Tag; name: string; scientificName: Maybe<string>; rank: Tag; parents: Inclusion[]; members: Tag[]; constraint: SetExpr;
  parts: Maybe<Partition>; gives: Tag[]; source: string };
type CrossSet = { name: string; meaning: string; members: Tag[]; answers: Array<{ whole: Tag; within: Maybe<boolean>; shared: Maybe<Tag[]> }> };
type Classification = { coverage: string; sets: LifeSet[]; crossSets: CrossSet[] };
type FoodFacts = { food: Tag; rank: Tag; name: string; within: Tag[]; source: Maybe<Tag> };
type FoodSet = { item: Tag; name: string; rank: Tag; parents: Inclusion[]; members: Tag[]; parts: Maybe<Partition>; comesFrom: Maybe<Tag> };
type Img = { width: number; height: number; pixels: Array<{ r: number; g: number; b: number; a: number }> };
type Species = { scientificName: string; commonNames: string[]; source: string; genus: { family: { scientificName: string } } };

let context: EvaluateContext;
let encyclopedia: FenelModule;
const just = <T,>(value: T): { $tag: "Just"; _0: T } => ({ $tag: "Just", _0: value });
const tag = (name: string) => ({ $tag: name });
const call = <T>(name: string, ...args: unknown[]): T =>
  withInterpretedResolver(() => invokeCallable({ $ref: name.includes(":") ? name : `Encyclopedia:${name}` }, args, context)) as T;
function variantCases(module: FenelModule, typeName: string): string[] {
  const entity = (module.entities as unknown as Array<{ id: string; type: { $variant?: { cases: Array<{ name: string }> } } }>).find(row => row.id === typeName);
  return entity?.type.$variant?.cases.map(row => row.name) ?? [];
}

beforeAll(() => withInterpretedResolver(() => {
  const countryDemo = { ...loadFenelModule(source("fenel/modules/publicdemo/encyclopedia-demo.fenel"), "EncyclopediaDemo"), nativeImpls: {
    "EncyclopediaDemo:encyclopediaSourceCountries": () => countries,
    "EncyclopediaDemo:encyclopediaTypeFromSet": (base: unknown, constraint: unknown) => setExprAsType(base as FenelType, constraint as SetExpr),
  } };
  const greek = loadFenelModule(source("fenel/modules/publicdemo/greek-alphabet-demo.fenel"), "GreekAlphabetDemo");
  encyclopedia = loadFenelModuleUnion(ENCYCLOPEDIA_FILES.map(name => ({ src: source(`fenel/modules/encyclopedia/${name}`), name })),
    { labels: { Encyclopedia: "Encyclopedia" } })[0]!;
  context = createRegistry([stdModule, decidableMembershipModule, countryDemo, greek, encyclopedia], { dispatchRegistry }).evaluateContext();
}), 300_000);

describe("the tree of life", () => {
  test("every living thing has exactly one facts row, and every food exactly one", () => {
    const rows = call<Facts[]>("encyclopediaLivingThingFacts");
    expect(rows.map(row => row.thing.$tag).sort()).toEqual([...variantCases(encyclopedia, "LivingThing")].sort());
    expect(new Set(rows.map(row => row.thing.$tag)).size).toBe(rows.length);
    const foods = call<FoodFacts[]>("encyclopediaFoodFacts");
    expect(foods.map(row => row.food.$tag).sort()).toEqual([...variantCases(encyclopedia, "Foodstuff")].sort());
    expect(new Set(foods.map(row => row.food.$tag)).size).toBe(foods.length);
    expect(rows.filter(row => row.rank.$tag === "RankSpecies")).toHaveLength(63);
    expect(rows[0]).toMatchObject({ thing: tag("AllLife"), rank: tag("RankLife"), within: [], scientificName: { $tag: "Nothing" } });
    for (const row of rows.slice(1)) expect(row.within[0]).toEqual(tag("AllLife"));
  });

  test("the twelve described species copy their records and agree on their family", () => {
    const rows = call<Facts[]>("encyclopediaLivingThingFacts");
    const pairs: Array<[string, string]> = [["FoeniculumVulgare", "commonFennel"], ["FerulaCommunis", "giantFennel"], ["DaucusCarota", "carrot"],
      ["ApiumGraveolens", "celery"], ["CoriandrumSativum", "coriander"], ["AnethumGraveolens", "dill"], ["HelianthusAnnuus", "sunflower"],
      ["HelianthusTuberosus", "jerusalemArtichoke"], ["ArctiumMinus", "lesserBurdock"], ["SolanumTuberosum", "potato"],
      ["SolanumTriflorum", "cutleafNightshade"], ["DaturaStramonium", "thornApple"]];
    for (const [thing, record] of pairs) {
      const row = rows.find(candidate => candidate.thing.$tag === thing)!;
      const species = call<Species>(record);
      expect([row.scientificName, row.commonNames, row.source]).toEqual([just(species.scientificName), species.commonNames, species.source]);
      expect(row.within.at(-1)).toEqual(tag(species.genus.family.scientificName));
    }
  });

  test("every shipped inclusion and every family partition is decided true", () => {
    const tree = call<Classification>("encyclopediaTreeOfLife");
    expect(tree.sets).toHaveLength(99);
    for (const set of tree.sets) {
      if (set.item.$tag === "AllLife") expect(set.parents).toEqual([]);
      else expect(set.parents.map(parent => parent.within)).toEqual([just(true)]);
      if (set.parts.$tag === "Just") expect([set.parts._0.apart, set.parts._0.cover]).toEqual([just(true), just(true)]);
    }
    // Families (the groups of species) are partitioned; groups of groups are not asked (cost, see life.fenel).
    expect(tree.sets.filter(set => set.parts.$tag === "Just").map(set => set.rank.$tag)).toEqual(Array(24).fill("RankFamily"));
    const solanaceae = tree.sets.find(set => set.item.$tag === "Solanaceae")!;
    expect(solanaceae.members.map(member => member.$tag)).toEqual(["SolanumTuberosum", "SolanumTriflorum", "DaturaStramonium",
      "SolanumLycopersicum", "SolanumMelongena", "CapsicumAnnuum"]);
    const tomato = tree.sets.find(set => set.item.$tag === "SolanumLycopersicum")!;
    expect([tomato.name, tomato.scientificName, tomato.members, tomato.gives]).toEqual(["Tomato", just("Solanum lycopersicum"),
      [tag("SolanumLycopersicum")], [tag("TomatoFood")]]);
    expect(tree.sets.find(set => set.item.$tag === "CitrusAurantium")!.gives).toEqual([tag("OrangeFood"), tag("GrapefruitFood")]);
    const [fennels] = tree.crossSets;
    expect([fennels!.name, fennels!.members]).toEqual(["Fennels", [tag("FoeniculumVulgare"), tag("FerulaCommunis")]]);
    expect(fennels!.answers.map(answer => [answer.whole.$tag, answer.within])).toEqual([["Plantae", just(true)], ["Magnoliopsida", just(true)], ["Apiaceae", just(true)]]);
  }, 300_000);

  test("a corrupted ancestry is judged not a subset, so the verdict is the judgment's", () => {
    const rows = structuredClone(call<Facts[]>("encyclopediaLivingThingFacts"));
    // Potato stated under the animals: Solanaceae's species are then not all inside Magnoliopsida.
    const potato = rows.find(row => row.thing.$tag === "SolanumTuberosum")!;
    potato.within = [tag("AllLife"), tag("Animalia"), tag("Solanaceae")];
    const tree = call<Classification>("encyclopediaLifeClassification", rows, []);
    const solanaceae = tree.sets.find(set => set.item.$tag === "Solanaceae")!;
    expect(solanaceae.parents).toEqual([{ $tag: "LifeSetInclusion", whole: tag("Magnoliopsida"), within: just(false) }]);
    expect(tree.sets.find(set => set.item.$tag === "Magnoliopsida")!.parents[0]!.within).toEqual(just(true));
  }, 300_000);

  test("no tree value holds an Image, and the tree stays small", () => {
    const tree = JSON.stringify(call<Classification>("encyclopediaTreeOfLife"));
    expect(tree).not.toContain("pixels");
    expect(tree.length).toBeLessThan(200_000);
    for (const name of ["encyclopediaFoods", "encyclopediaFoodSourceSets", "encyclopediaNightshadeFoods", "encyclopediaNightshades", "encyclopediaTreeOfLifeLeaves"]) {
      expect(JSON.stringify(call<unknown>(name))).not.toContain("pixels");
    }
  }, 300_000);

  test("the leaves and the leaves of a group are lists of living things", () => {
    expect(call<Tag[]>("encyclopediaTreeOfLifeLeaves")).toHaveLength(63);
    expect(call<Tag[]>("encyclopediaLeavesOf", tag("Rutaceae"))).toEqual([tag("CitrusLimon"), tag("CitrusAurantium"), tag("CitrusAurantiifolia")]);
    expect(call<Tag[]>("encyclopediaLeavesOf", tag("SolanumLycopersicum"))).toEqual([tag("SolanumLycopersicum")]);
  });
});

describe("foods", () => {
  test("each food is in exactly one kind, names its living thing, and every inclusion is decided true", () => {
    const value = call<{ sets: FoodSet[] }>("encyclopediaFoods");
    expect(value.sets).toHaveLength(88);
    for (const set of value.sets) {
      if (set.item.$tag !== "AllFoods") expect(set.parents.map(parent => parent.within)).toEqual([just(true)]);
      if (set.parts.$tag === "Just") expect([set.parts._0.apart, set.parts._0.cover]).toEqual([just(true), just(true)]);
      if (set.rank.$tag === "FoodRankFood" || set.rank.$tag === "FoodRankVariety") expect(set.comesFrom.$tag).toBe("Just");
    }
    // Every kind and the tomato (a food with varieties) are partitioned; all foods is not asked.
    expect(value.sets.filter(set => set.parts.$tag === "Just").map(set => set.item.$tag)).toEqual(["Fruits", "Vegetables", "TomatoFood",
      "Herbs", "Grains", "Pulses", "Seeds", "Mushrooms", "Dairy", "Meat", "Eggs", "Seafood", "BeeProducts"]);
    const tomato = value.sets.find(set => set.item.$tag === "TomatoFood")!;
    expect([tomato.name, tomato.parents[0]!.whole, tomato.comesFrom]).toEqual(["Tomato", tag("Vegetables"), just(tag("SolanumLycopersicum"))]);
  }, 300_000);

  test("tomato varieties are foods below the tomato, from the same plant", () => {
    const value = call<{ sets: FoodSet[] }>("encyclopediaFoods");
    const varieties = ["CherryTomatoesFood", "PlumTomatoFood", "BeefsteakTomatoFood", "YellowTomatoFood", "TomatoesOnTheVineFood"];
    expect(value.sets.find(set => set.item.$tag === "TomatoFood")!.members).toEqual(varieties.map(tag));
    for (const name of varieties) {
      const set = value.sets.find(candidate => candidate.item.$tag === name)!;
      expect([set.rank, set.parents, set.members, set.comesFrom]).toEqual([tag("FoodRankVariety"),
        [{ $tag: "FoodSetInclusion", whole: tag("TomatoFood"), within: just(true) }], [tag(name)], just(tag("SolanumLycopersicum"))]);
    }
    expect(value.sets.find(set => set.item.$tag === "Vegetables")!.members).toEqual(expect.arrayContaining(varieties.map(tag)));
    expect(value.sets.find(set => set.item.$tag === "Vegetables")!.members).not.toContainEqual(tag("TomatoFood"));
    // The tree of life still shows one food mark per food, not one per variety.
    const tree = call<Classification>("encyclopediaTreeOfLife");
    expect(tree.sets.find(set => set.item.$tag === "SolanumLycopersicum")!.gives).toEqual([tag("TomatoFood")]);
  }, 300_000);

  test("the nightshades and their foods: one branch of the tree, judged, with each species' foods", () => {
    const branch = call<Classification>("encyclopediaNightshades");
    expect(branch.crossSets).toEqual([]);
    expect(branch.sets.map(set => [set.item.$tag, set.parents.map(parent => [parent.whole.$tag, parent.within]), set.gives.map(food => food.$tag)])).toEqual([
      ["Solanaceae", [], []],
      ["SolanumTuberosum", [["Solanaceae", just(true)]], ["PotatoFood"]],
      ["SolanumTriflorum", [["Solanaceae", just(true)]], []],
      ["DaturaStramonium", [["Solanaceae", just(true)]], []],
      ["SolanumLycopersicum", [["Solanaceae", just(true)]], ["TomatoFood"]],
      ["SolanumMelongena", [["Solanaceae", just(true)]], ["AubergineFood"]],
      ["CapsicumAnnuum", [["Solanaceae", just(true)]], ["SweetPepperFood", "ChilliFood"]],
    ]);
    expect(branch.sets[0]!.parts).toEqual(just({ $tag: "LifeSetPartition", apart: just(true), cover: just(true) }));
  }, 300_000);

  test("foods from the nightshades: decided, with the two that give none", () => {
    expect(call<unknown>("encyclopediaNightshadeFoods")).toEqual({ $tag: "FoodsFromGroup", group: tag("Solanaceae"),
      foods: just(["TomatoFood", "PotatoFood", "AubergineFood", "SweetPepperFood", "ChilliFood"].map(tag)),
      givers: just(["SolanumTuberosum", "SolanumLycopersicum", "SolanumMelongena", "CapsicumAnnuum"].map(tag)),
      withoutFood: just(["SolanumTriflorum", "DaturaStramonium"].map(tag)), everyMemberGives: just(false) });
  }, 300_000);
});

describe("constructor identities", () => {
  test("every new tag is owned by its own type, and the recipe's Food keeps its nine", () => {
    const owners = new Map<string, string[]>();
    for (const module of [stdModule, ...PUBLIC_DEMO_MODULES]) {
      for (const entity of module.entities as unknown as Array<{ id: string; type: { $variant?: { cases: Array<{ name: string }> } } }>) {
        for (const row of entity.type.$variant?.cases ?? []) owners.set(row.name, [...(owners.get(row.name) ?? []), entity.id]);
      }
    }
    for (const type of ["LivingThing", "Foodstuff", "LifeRank", "FoodRank"]) {
      for (const name of variantCases(encyclopedia, type)) expect([name, owners.get(name)]).toEqual([name, [type]]);
    }
    const food = PUBLIC_DEMO_MODULES.flatMap(module => variantCases(module, "Food"));
    expect(food).toEqual(["Butter", "CoconutCream", "Cream", "Honey", "LemonJuice", "Egg", "Tomato", "Watermelon", "Cucumber"]);
    for (const name of food) expect(owners.get(name)).toEqual(["Food"]);
  });

  test("a constructor reads by its own label; a lower-case function beside it keeps its meaning", () => {
    // The rows the system registry installs, keyed by the bare tag as the recipe's `_ : Emojiable "Tomato"` is.
    // Labelable rows carry their label on the row itself (the loader's identity-facet projection), the others in methods.
    const methods = (cls: string, key: string) => {
      const row = (encyclopedia.instances ?? []).find(candidate => candidate.typeName === cls && candidate.args[0] === key) as { methods: Record<string, unknown>; label?: unknown } | undefined;
      return row === undefined ? undefined : cls === "Labelable" ? { label: row.label } : row.methods;
    };
    expect(methods("Labelable", "SolanumLycopersicum")).toEqual({ label: "Tomato" });
    expect(methods("Labelable", "TomatoFood")).toEqual({ label: "Tomato" });
    expect(methods("Labelable", "CherryTomatoesFood")).toEqual({ label: "Cherry tomatoes" });
    expect(methods("Picturable", "TomatoesOnTheVineFood")).toEqual({ picture: { $ref: "vineTomatoesDrawing" } });
    expect(methods("Labelable", "CitrusLimon")).toEqual({ label: "Lemon" });
    expect(methods("Picturable", "SolanumLycopersicum")).toEqual({ picture: { $ref: "tomatoDrawing" } });
    expect(methods("Picturable", "Solanaceae")).toEqual({ picture: { $ref: "solanaceaeBadgeDrawing" } });
    expect(methods("Emojiable", "Mammalia")).toEqual({ emoji: "🐾" });
    expect(call<{ scientificName: string }>("apiaceae").scientificName).toBe("Apiaceae");
    expect(call<Facts[]>("encyclopediaLivingThingFacts").find(row => row.thing.$tag === "Apiaceae")!.scientificName).toEqual(just("Apiaceae"));
  });
});

describe("palette pictures", () => {
  const std = <T>(name: string, ...args: unknown[]) => call<T>(`std:${name}`, ...args);
  const empty = { width: 0, height: 0, pixels: [] };

  test("a palette decode equals the packed decode of the same pixels; a wrong count or letter is the empty image", () => {
    const palette = "4278190335 16711935 0";
    expect(std<Img>("imageFromPalette", 3, 2, palette, "012210")).toEqual(std<Img>("imageFromPackedRgba", 3, 2,
      "4278190335 16711935 0 0 16711935 4278190335"));
    expect(std<Img>("imageFromPalette", 3, 2, palette, "01221")).toEqual(empty);
    expect(std<Img>("imageFromPalette", 3, 2, palette, "012213")).toEqual(empty);
    expect(std<Img>("imageFromPalette", 1, 1, Array(65).fill("255").join(" "), "0")).toEqual(empty);
    expect(std<Img>("imageFromPalette", 1, 1, Array.from({ length: 64 }, (_, i) => String(i * 256 + 255)).join(" "), "/").pixels)
      .toEqual([{ r: 0, g: 0, b: 63, a: 255 }]);
  });

  test.skipIf(!existsSync(new URL(PICTURE_HASHES, root)))("every picture decodes to its recorded size and pixel hash", () => {
    const hashes = JSON.parse(source(PICTURE_HASHES)) as Array<{ definition: string; width: number; height: number; colours: number; pixelSha256: string }>;
    expect(hashes).toHaveLength(217);
    for (const row of hashes) {
      const image = call<Img>(row.definition);
      const bytes = Buffer.from(image.pixels.flatMap(pixel => [pixel.r, pixel.g, pixel.b, pixel.a]));
      expect([row.definition, image.width, image.height, createHash("sha256").update(bytes).digest("hex")])
        .toEqual([row.definition, row.width, row.height, row.pixelSha256]);
      expect(row.colours).toBeLessThanOrEqual(row.height === 96 ? 16 : 64);
    }
  }, 600_000);
});

describe("a tree of 400 synthetic species in a small host stack", () => {
  // The repository's 256 KB realm (set-algebra-enum-stack.test.ts) cannot build a registry: the build itself overflows
  // there (measured Nov 11). A 1 MB realm builds it and still discriminates: a walk that recurses once per item (the
  // shape that overflowed the browser worker on the Countries page) overflows at 5000 items while the tree's own walks
  // pass at 5000 and the whole classification passes at 400 species.
  test("builds in a 1 MB-stack realm, where a once-per-item recursion overflows", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const result = Bun.spawnSync([process.execPath, "-e", `
      await import("./engine-body-host-install.ts");
      const { readFileSync } = await import("node:fs");
      const { loadFenelModuleUnion } = await import("./fenel-module.ts");
      const { createRegistry } = await import("./registry.ts");
      const { stdModule } = await import("./modules/std.ts");
      const { decidableMembershipModule } = await import("./modules/decidable-membership.ts");
      const { dispatchRegistry } = await import("./system-entities.ts");
      const { invokeCallable } = await import("./json-logic.ts");
      const { withInterpretedResolver } = await import("./engine-bodies-dispatch.ts");
      const src = name => readFileSync(new URL("../../../../fenel/modules/encyclopedia/" + name, import.meta.url), "utf8");
      // life.fenel alone, with stand-ins for the names it uses from the other files, and the recursive control.
      const stub = [
        "module Encyclopedia where", "", "using std (head, tail, fromMaybe)", "",
        "LivingThing = AllLife", "Foodstuff = AllFoods", "FoodRank = FoodRankAll | FoodRankKind | FoodRankFood",
        "FoodFacts = FoodFacts food: Foodstuff rank: FoodRank name: String within: List Foodstuff source: Maybe LivingThing",
        "PlantSpecies = PlantSpecies scientificName: String commonNames: List String source: UrlStr",
        "encyclopediaNameEndsWith : (word: String) -> (commonName: String) -> Bool", "encyclopediaNameEndsWith word commonName = false",
        "encyclopediaFennelsMeaning : String", "encyclopediaFennelsMeaning = " + JSON.stringify("x"),
        "encyclopediaLivingThingFacts : List LivingThingFacts", "encyclopediaLivingThingFacts = []",
        "encyclopediaFoodFacts : List FoodFacts", "encyclopediaFoodFacts = []", "",
        "probeCount : (xs: List Number) -> Number", "probeCount xs = case head xs of", "  Just first -> 1 + probeCount (fromMaybe [] (tail xs))", "  _ -> 0", ""].join("\\n");
      const module = loadFenelModuleUnion([{ src: src("life.fenel"), name: "life.fenel" }, { src: stub, name: "stub.fenel" }])[0];
      const context = withInterpretedResolver(() => createRegistry([stdModule, decidableMembershipModule, module], { dispatchRegistry })).evaluateContext();
      const call = (name, ...args) => withInterpretedResolver(() => invokeCallable({ $ref: "Encyclopedia:" + name }, args, context));
      const attempt = f => { try { return f(); } catch (e) { return String(e && e.name); } };
      const row = (thing, rank, within) => ({ $tag: "LivingThingFacts", thing: { $tag: thing }, rank: { $tag: rank },
        scientificName: { $tag: "Just", _0: thing }, commonNames: [], within: within.map(t => ({ $tag: t })), source: "https://example.org" });
      const rows = [{ ...row("AllLife", "RankLife", []), scientificName: { $tag: "Nothing" } }, row("K", "RankKingdom", ["AllLife"]), row("C", "RankClass", ["AllLife", "K"])];
      for (let f = 0; f < 50; f++) { rows.push(row("F" + f, "RankFamily", ["AllLife", "K", "C"]));
        for (let s = 0; s < 8; s++) rows.push(row("S" + (f * 8 + s), "RankSpecies", ["AllLife", "K", "C", "F" + f])); }
      const many = Array.from({ length: 5000 }, (_, i) => ({ $tag: "S" + i }));
      const tree = attempt(() => call("encyclopediaLifeClassification", rows, []));
      console.log(JSON.stringify({
        sets: tree.sets?.length ?? tree, root: tree.sets?.[0].members.length,
        notTrue: tree.sets?.filter(s => s.parents.some(p => p.within._0 !== true)).length,
        rotate: attempt(() => call("encyclopediaRotateTo", [many[4999]], many).length),
        apart: attempt(() => call("encyclopediaSetsApart", [many.slice(0, 2500), []])),
        control: attempt(() => call("probeCount", Array.from({ length: 5000 }, (_, i) => i))),
      }));
    `], { cwd: here, env: { ...process.env, BUN_JSC_maxPerThreadStackUsage: String(1024 * 1024) }, stdout: "pipe", stderr: "pipe" });
    const stdout = result.stdout.toString();
    if (result.exitCode !== 0) throw new Error(`realm failed (${result.exitCode}): ${result.stderr.toString()}\n${stdout}`);
    expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({ sets: 453, root: 400, notTrue: 0, rotate: 5000,
      apart: { $tag: "Just", _0: true }, control: "RangeError" });
  }, 1_800_000);
});
