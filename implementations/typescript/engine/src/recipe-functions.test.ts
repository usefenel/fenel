import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadFenelModule } from "./fenel-module";
import { evaluate, invokeCallable, reflectionNativeRoute, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";
import { unitsModule } from "./modules/units";

// C1: exercise the authored Fenel domain and recipes through the normal loader
// and evaluator. Enumerating pantries here is a concrete test oracle only.
const FOOD_NAMES = ["Butter", "CoconutCream", "Cream", "Honey", "LemonJuice", "Egg", "Tomato", "Watermelon", "Cucumber"] as const;
type FoodName = typeof FOOD_NAMES[number];
type Food = { $tag: FoodName };
type Fact = { $tag: "NutrientFact"; food: Food; nutrient: { $tag: "FatFraction" }; amount: number; source: { $tag: "IllustrativeFact"; description: string } };
let context: EvaluateContext;
let loaded: ReturnType<typeof loadFenelModule>;

beforeAll(() => {
  const source = readFileSync(new URL("../../../../fenel/modules/publicdemo/recipe-functions.fenel", import.meta.url), "utf8");
  loaded = loadFenelModule(source, "RecipeFunctions");
  context = createRegistry([stdModule, unitsModule, loaded]).evaluateContext();
}, 900_000);

function food(name: FoodName): Food { return { $tag: name }; }
function foods(...names: FoodName[]): Food[] { return names.map(food); }
function call(name: string, ...args: unknown[]): any {
  return invokeCallable({ $ref: `RecipeFunctions:${name}` }, args, context);
}
function fact(name: FoodName, amount: number): Fact {
  return { $tag: "NutrientFact", food: food(name), nutrient: { $tag: "FatFraction" }, amount, source: { $tag: "IllustrativeFact", description: "Synthetic test input, not a nutritional measurement." } };
}
function snapshot(facts: Fact[] = [], refinements: unknown[] = [], categories: unknown[] = []): any {
  return { $tag: "FoodFactSnapshot", version: 7, foodRankVersion: 1, classifiedFoods: [], categories, categoryInclusions: [], refinements, nutrients: facts };
}
const FAT = { $tag: "FatFraction" };

describe("source-owned recipe functions", () => {
  test("the frozen Food order is total and injective, with direct list refinements", () => {
    expect(call("foodRankVersion")).toBe(1);
    expect(FOOD_NAMES.map(name => call("foodRank", food(name)))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const declaredFood = loaded.entities?.find(entity => entity.id === "Food")?.type as any;
    expect(declaredFood.$variant.cases.map((item: any) => item.name)).toEqual(FOOD_NAMES);
    for (const name of ["Pantry", "Ingredients"]) {
      const type = loaded.entities?.find(entity => entity.id === name)?.type;
      expect(type).toHaveProperty("$refined");
      expect(type).not.toHaveProperty("$el");
    }
    const recipe = loaded.entities?.find(entity => entity.id === "Recipe")?.type as any;
    const recipeBase = recipe.$refined?.base ?? recipe;
    expect(recipeBase).toHaveProperty("$arrow");
    expect(recipeBase.$arrow.params).toHaveLength(1);
    expect(recipeBase.$arrow.params[0].type).toEqual({ $ref: "Pantry" });
    expect(JSON.stringify(recipeBase.$arrow.returns)).toContain("Ingredients");
  });

  test("canonical membership refuses duplicates and descending lists without normalising", () => {
    expect(call("canonicalFoods", [])).toBe(true);
    expect(call("canonicalFoods", foods("Butter", "Cream", "Cucumber"))).toBe(true);
    for (const input of [foods("Butter", "Butter"), foods("Cream", "Butter"), foods("Cucumber", "Tomato")]) {
      const before = structuredClone(input);
      expect(call("canonicalFoods", input)).toBe(false);
      expect(input).toEqual(before);
    }
  });

  test("the authored Ingredients predicate is structural and checks nonempty canonical lists", () => {
    const type = loaded.entities?.find(entity => entity.id === "Ingredients")?.type as any;
    const predicate = type.$refined.set.pred;
    expect(Object.keys(predicate)).toEqual(["if"]);
    expect(predicate.if).toHaveLength(3);
    expect(predicate.if[2]).toBe(false);
    for (const [input, expected] of [
      [foods(), false], [foods("Butter"), true], [foods("Butter", "Egg"), true],
      [foods("Egg", "Butter"), false], [foods("Butter", "Butter"), false],
    ] as const) expect(evaluate(predicate, { value: input }, context)).toBe(expected);
  });

  test("canonical membership refuses rank-equivalent foods with extra enumerable data", () => {
    for (const [rank, name] of FOOD_NAMES.entries()) {
      const extended = { ...food(name), extra: 1 };
      expect(invokeCallable({ $ref: "std:eq" }, [extended, food(name)], context)).toBe(false);
      expect(call("foodRank", extended)).toBe(rank);
      const input = [extended];
      const before = structuredClone(input);
      expect(call("canonicalFoods", input)).toBe(false);
      expect(input).toEqual(before);
      if (rank > 0) expect(call("canonicalFoods", [food("Butter"), extended])).toBe(false);
    }
  });

  test("canonical membership refuses inherited and hidden tag carriers distinguished by ordinary equality", () => {
    const inheritedTag = Object.create({ $tag: "Butter" });
    const hiddenTag = Object.defineProperty({}, "$tag", { value: "Butter", enumerable: false });
    for (const candidate of [inheritedTag, hiddenTag]) {
      const before = Object.getOwnPropertyDescriptors(candidate);
      const prototype = Object.getPrototypeOf(candidate);
      expect(invokeCallable({ $ref: "std:eq" }, [candidate, food("Butter")], context)).toBe(false);
      expect(call("canonicalFoods", [candidate])).toBe(false);
      expect(Object.getOwnPropertyDescriptors(candidate)).toEqual(before);
      expect(Object.getPrototypeOf(candidate)).toBe(prototype);
    }
  });

  test("the moisturizing-lubrication formula returns both alternatives when both fats are present, and every core ingredient is necessary", () => {
    const core = foods("Honey", "LemonJuice", "Egg");
    expect(call("lubeFormula", core)).toEqual([]);
    expect(call("lubeFormula", foods("Butter", "Honey", "LemonJuice", "Egg"))).toEqual([foods("Butter", "Honey", "LemonJuice", "Egg")]);
    expect(call("lubeFormula", foods("CoconutCream", "Honey", "LemonJuice", "Egg"))).toEqual([foods("CoconutCream", "Honey", "LemonJuice", "Egg")]);
    expect(call("lubeFormula", FOOD_NAMES.map(food))).toEqual([foods("Butter", "Honey", "LemonJuice", "Egg"), foods("CoconutCream", "Honey", "LemonJuice", "Egg")]);
    for (const missing of ["Honey", "LemonJuice", "Egg"] as const) {
      expect(call("lubeFormula", FOOD_NAMES.filter(name => name !== missing).map(food))).toEqual([]);
    }
  });

  test("the three public calls give the moisturizing-lubrication formula three lists of foods: one preparation, two, none", () => {
    expect(call("lubeWithButter")).toEqual([foods("Butter", "Honey", "LemonJuice", "Egg")]);
    expect(call("lubeWithButterAndCoconutCream")).toEqual([foods("Butter", "Honey", "LemonJuice", "Egg"), foods("CoconutCream", "Honey", "LemonJuice", "Egg")]);
    expect(call("lubeWithoutHoney")).toEqual([]);
    // Each call is the formula applied to an ordered list of foods, as source.
    for (const [name, inputs] of [
      ["lubeWithButter", ["Butter", "Honey", "LemonJuice", "Egg"]],
      ["lubeWithButterAndCoconutCream", ["Butter", "CoconutCream", "Honey", "LemonJuice", "Egg"]],
      ["lubeWithoutHoney", ["Butter", "CoconutCream", "LemonJuice", "Egg"]],
    ] as const) {
      const fn = loaded.functions?.find(row => row.id === `RecipeFunctions:${name}`) as { params: unknown[]; body?: unknown };
      expect(fn.params).toEqual([]);
      expect(fn.body).toEqual({ call: ["lubeFormula", inputs.map(input => ({ construct: [input] }))] });
      expect(call("canonicalFoods", foods(...inputs))).toBe(true);
    }
    // The input is named foods where people read it.
    const lube = loaded.functions?.find(row => row.id === "RecipeFunctions:lubeFormula");
    expect(lube?.params.map(param => param.name)).toEqual(["foods"]);
  });

  test("hydration produces every available preparation of at least two foods, including the triple", () => {
    expect(call("hydrationFormula", [])).toEqual([]);
    expect(call("hydrationFormula", foods("Tomato"))).toEqual([]);
    expect(call("hydrationFormula", foods("Tomato", "Watermelon"))).toEqual([foods("Tomato", "Watermelon")]);
    expect(call("hydrationFormula", foods("Tomato", "Cucumber"))).toEqual([foods("Tomato", "Cucumber")]);
    expect(call("hydrationFormula", foods("Watermelon", "Cucumber"))).toEqual([foods("Watermelon", "Cucumber")]);
    expect(call("hydrationFormula", FOOD_NAMES.map(food))).toEqual([foods("Tomato", "Watermelon"), foods("Tomato", "Cucumber"), foods("Watermelon", "Cucumber"), foods("Tomato", "Watermelon", "Cucumber")]);
  });

  test("hydration classification observes all three equalities once in source order", () => {
    const route = reflectionNativeRoute(context, "std:eq");
    expect(route).toBeDefined();
    if (route === undefined) throw new Error("The source equality route is unavailable");
    for (const name of ["Tomato", "Watermelon", "Cucumber", "Butter"] as const) {
      const input = food(name);
      const observations: Array<[unknown, unknown]> = [];
      const original = route.implementation;
      const plain = (...args: unknown[]) => { observations.push([args[0], args[1]]); return original(...args); };
      const contextual = (current: EvaluateContext, ...args: unknown[]) => { observations.push([args[0], args[1]]); return original(current, ...args); };
      const key = route.kind === "plain" ? "natives" : "nativesCtx";
      const table = Object.assign(Object.create(null), context[key]);
      for (const alias of Object.keys(table)) {
        if (table[alias] === original) table[alias] = route.kind === "plain" ? plain : contextual;
      }
      const observedContext = { ...context, [key]: table };
      expect(invokeCallable({ $ref: "RecipeFunctions:hydrationFood" }, [input], observedContext)).toBe(name !== "Butter");
      expect(observations.map(([, compared]) => compared)).toEqual(foods("Tomato", "Watermelon", "Cucumber"));
      for (const [observedInput] of observations) expect(observedInput).toBe(input);
    }
  });

  test("both recipes agree with the concrete pantry oracle over all 512 admitted subsets", () => {
    const lubeCandidates = [["Butter", "Honey", "LemonJuice", "Egg"], ["CoconutCream", "Honey", "LemonJuice", "Egg"]] as FoodName[][];
    const hydrationCandidates = [["Tomato", "Watermelon"], ["Tomato", "Cucumber"], ["Watermelon", "Cucumber"], ["Tomato", "Watermelon", "Cucumber"]] as FoodName[][];
    for (let mask = 0; mask < 1 << FOOD_NAMES.length; mask++) {
      const names = FOOD_NAMES.filter((_, index) => (mask & (1 << index)) !== 0);
      const pantry = names.map(food);
      expect(call("canonicalFoods", pantry)).toBe(true);
      for (const [name, candidates] of [["lubeFormula", lubeCandidates], ["hydrationFormula", hydrationCandidates]] as const) {
        const expected = candidates.filter(preparation => preparation.every(item => names.includes(item))).map(preparation => preparation.map(food));
        const actual = call(name, pantry) as Food[][];
        expect(actual).toEqual(expected);
        for (const preparation of actual) {
          expect(preparation.length).toBeGreaterThan(0);
          expect(call("canonicalFoods", preparation)).toBe(true);
        }
      }
    }
  }, 120_000);

  test("default facts are explicitly versioned and missing nutrition stays unknown", () => {
    const supplied = call("recipeSnapshot");
    expect(supplied.facts).toMatchObject({ $tag: "FoodFactSnapshot", version: 2, foodRankVersion: 1, nutrients: [], refinements: [] });
    expect(supplied.rule.version).toBe(1);
    expect(call("resolveNutrient", supplied, food("Butter"), FAT)).toEqual({ $tag: "Nothing" });
    expect(call("fatRich", supplied, food("Butter"))).toEqual({ $tag: "Nothing" });
  });

  test("the live-reader descriptor carries actual type and function values", () => {
    const descriptor = call("recipeDomainDescriptor");
    for (const name of ["food", "pantry", "ingredients"]) {
      expect(descriptor[name]).toEqual({ $ref: expect.any(String) });
    }
    expect(new Set([descriptor.food.$ref, descriptor.pantry.$ref, descriptor.ingredients.$ref]).size).toBe(3);
    expect(descriptor.rankVersion).toBe(call("foodRankVersion"));
    expect(invokeCallable(descriptor.rank, [food("Tomato")], context)).toBe(6);
    expect(invokeCallable(descriptor.canonical, [foods("Butter", "Egg")], context)).toBe(true);
    expect(invokeCallable(descriptor.canonicalAfter, [6, foods("Watermelon", "Cucumber")], context)).toBe(true);
    expect(descriptor.snapshot).toEqual(call("recipeSnapshot"));
  });

  test("classification does not pass nutrient facts; specialization records inherited provenance", () => {
    // These hypothetical edges and numbers are supplied test fixtures only.
    const source = snapshot([fact("Cream", 0.8)], [], [{ $tag: "FoodInCategory", food: food("Butter"), category: { $tag: "DairyFood" } }, { $tag: "FoodInCategory", food: food("Cream"), category: { $tag: "DairyFood" } }]);
    expect(call("statedThenGeneral", source, food("Butter"), FAT)).toEqual({ $tag: "Nothing" });
    source.refinements = [{ $tag: "FoodRefines", specific: food("Butter"), general: food("Cream") }];
    expect(call("statedNutrients", source, food("Butter"), FAT)).toEqual({ $tag: "Nothing" });
    expect(call("statedThenGeneral", source, food("Butter"), FAT)).toMatchObject({ $tag: "Just", _0: { amount: 0.8, origin: { $tag: "InheritedFrom", general: food("Cream"), origin: { $tag: "Stated", source: fact("Cream", 0.8).source } } } });
    source.nutrients.push(fact("Butter", 0.3));
    expect(call("statedThenGeneral", source, food("Butter"), FAT)).toMatchObject({ $tag: "Just", _0: { amount: 0.3, origin: { $tag: "Stated" } } });
  });

  test("averaging is a swappable rule over known specifics, preserving source origins", () => {
    const source = snapshot([fact("Butter", 0.2), fact("CoconutCream", 0.6)], [{ $tag: "FoodRefines", specific: food("Butter"), general: food("Cream") }, { $tag: "FoodRefines", specific: food("CoconutCream"), general: food("Cream") }]);
    expect(call("statedThenGeneral", source, food("Cream"), FAT)).toEqual({ $tag: "Nothing" });
    const resolved = call("statedThenGeneralThenAverage", source, food("Cream"), FAT);
    expect(resolved).toMatchObject({ $tag: "Just", _0: { amount: 0.4, origin: { $tag: "AveragedFrom" } } });
    expect(resolved._0.origin.specifics).toHaveLength(2);
    expect(resolved._0.origin.specifics.map((entry: any) => entry.origin.$tag)).toEqual(["Stated", "Stated"]);
    const wrapped = { $tag: "RecipeSnapshot", facts: source, rule: { $tag: "NutrientResolutionRule", version: 2, resolve: { $ref: "RecipeFunctions:statedThenGeneralThenAverage" } } };
    expect(call("resolveNutrient", wrapped, food("Cream"), FAT)).toEqual(resolved);
    expect(call("fatRich", wrapped, food("Cream"))).toEqual({ $tag: "Just", _0: false });
  });

  test("cyclic specialization without any fact terminates as unknown", () => {
    const source = snapshot([], [{ $tag: "FoodRefines", specific: food("Butter"), general: food("Cream") }, { $tag: "FoodRefines", specific: food("Cream"), general: food("Butter") }]);
    expect(call("statedThenGeneral", source, food("Butter"), FAT)).toEqual({ $tag: "Nothing" });
    expect(call("statedThenGeneralThenAverage", source, food("Butter"), FAT)).toEqual({ $tag: "Nothing" });
  });
});
