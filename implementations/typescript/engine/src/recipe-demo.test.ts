import { beforeAll, describe, expect, test } from "bun:test";
import SOURCE from "../../../../fenel/modules/publicdemo/recipe-demo.fenel?raw";
import { loadFenelModule } from "./fenel-module";
import { invokeCallable, type EvaluateContext } from "./json-logic";
import { createRegistry } from "./registry";
import { stdModule } from "./modules/std";

// C1: execute the source-owned predicates through the ordinary evaluator.
// These controls pin authored outcomes; no test-local recipe rule engine exists.
type Kind = { $tag: "RecipePlant" | "RecipeAnimal" };
type Food = { $tag: "RecipeFood"; id: string; name: string; kind: Kind; notes: string };
type Recipe = { $tag: "RecipeDefinition"; id: string; name: string; ingredientIds: string[]; preparationMinutes: number };
type Rules = {
  $tag: "RecipeRules";
  maximumPreparationMinutes: number;
  ingredientPolicy: { $tag: "RecipeAnyIngredients" | "RecipePlantIngredientsOnly" };
  excludedFoodIds: string[];
};
type Input = {
  $tag: "RecipePlanInput";
  foods: Food[];
  recipes: Recipe[];
  availableFoodIds: string[];
  schedule: { $tag: "RecipeSchedule"; startMinute: number; finishMinute: number };
  rules: Rules;
};
type Reason = { $tag: "RecipeRuleReason"; rule: { $tag: string }; passed: boolean; affectedFoodIds: string[]; explanation: string };
type Decision = { $tag: "RecipeDecision"; recipe: Recipe; eligible: boolean; reasons: Reason[] };
type Plan = {
  $tag: "RecipePlan";
  input: Input;
  availableMinutes: number;
  decisions: Decision[];
  eligibleRecipes: Recipe[];
  funnel: { $tag: "RecipeAdjustInputs"; message: string } | { $tag: "RecipeOfferOne"; recipeId: string } | { $tag: "RecipeChooseSeveral"; recipeIds: string[] };
  explanation: string;
};
type Result<T> = { $tag: "Ok"; _0: T } | { $tag: "Err"; _0: string };
const RULE_ORDER = [
  "RecipeIngredientsPresent", "RecipeCatalogueKnown", "RecipePantryAvailable",
  "RecipePreferenceMatches", "RecipeExclusionsAllowed", "RecipeMaximumFits", "RecipeScheduleFits",
];
let context: EvaluateContext;
beforeAll(() => {
  context = createRegistry([stdModule, loadFenelModule(SOURCE, "RecipeDemo")]).evaluateContext();
}, 180_000);

function call(name: string, ...args: unknown[]): unknown {
  return invokeCallable({ $ref: `RecipeDemo:${name}` }, args, context);
}
function initial(): Input {
  return structuredClone(call("recipeStartingInput")) as Input;
}
function ok(value: unknown): Plan {
  const result = value as Result<Plan>;
  expect(result.$tag, JSON.stringify(result)).toBe("Ok");
  if (result.$tag !== "Ok") throw new Error(result._0);
  return result._0;
}
function refused(value: unknown): string {
  const result = value as Result<Plan>;
  expect(result.$tag, JSON.stringify(result)).toBe("Err");
  if (result.$tag !== "Err") throw new Error("Expected the planner to refuse invalid input");
  expect(result._0.length).toBeGreaterThan(0);
  return result._0;
}
function reason(plan: Plan, recipeId: string, rule: string): Reason {
  const found = plan.decisions.find(decision => decision.recipe.id === recipeId)?.reasons.find(entry => entry.rule.$tag === rule);
  expect(found).toBeDefined();
  return found!;
}
function ids(plan: Plan): string[] {
  return plan.eligibleRecipes.map(recipe => recipe.id);
}

describe("Fenel-owned recipe planning", () => {
  test("source examples, seven named reasons and the funnel share the same actual input", () => {
    const input = initial();
    const before = structuredClone(input);
    const plan = ok(call("planRecipes", input));
    expect(plan.$tag).toBe("RecipePlan");
    expect(plan.input).toEqual(input);
    expect(input.foods).toEqual(call("recipeFoodCatalogue") as Food[]);
    expect(input.recipes).toEqual(call("recipeCatalogue") as Recipe[]);
    expect(input.rules).toEqual(call("recipeStartingRules") as Rules);
    expect(plan.availableMinutes).toBe(20);
    expect(ids(plan)).toEqual(["chickpea-bowl", "tomato-toast"]);
    expect(plan.funnel).toEqual({ $tag: "RecipeChooseSeveral", recipeIds: ["chickpea-bowl", "tomato-toast"] });
    expect(plan.decisions.map(decision => [decision.recipe.id, decision.eligible, decision.reasons.map(entry => entry.passed)])).toEqual([
      ["chickpea-bowl", true, [true, true, true, true, true, true, true]],
      ["tomato-toast", true, [true, true, true, true, true, true, true]],
      ["egg-toast", false, [true, true, true, false, true, true, true]],
      ["chicken-rice", false, [true, true, false, false, true, false, false]],
    ]);
    for (const decision of plan.decisions) {
      expect(decision.reasons.map(entry => entry.rule.$tag)).toEqual(RULE_ORDER);
      expect(decision.reasons.every(entry => entry.explanation.length > 0)).toBe(true);
    }
    expect(reason(plan, "egg-toast", "RecipePreferenceMatches").affectedFoodIds).toEqual(["egg"]);
    expect(reason(plan, "chicken-rice", "RecipePantryAvailable").affectedFoodIds).toEqual(["chicken", "rice"]);
    expect(reason(plan, "chicken-rice", "RecipePreferenceMatches").affectedFoodIds).toEqual(["chicken"]);
    expect(input).toEqual(before);
    expect(ok(call("planRecipes", input))).toEqual(plan);
  });

  test("the source starting-input transport names the five actual callables", () => {
    const examples = call("recipeDemoStartingInputs") as Array<{ function: { $ref: string }; arguments: unknown[] }>;
    expect(examples.map(example => example.function)).toEqual([
      { $ref: "RecipeDemo:planRecipes" }, { $ref: "RecipeDemo:recipesInWindow" },
      { $ref: "RecipeDemo:recipesWithRules" }, { $ref: "RecipeDemo:recipeFoodCatalogue" },
      { $ref: "RecipeDemo:recipeCatalogue" },
    ]);
    expect(examples.map(example => example.arguments)).toEqual([[
      initial(),
    ], [720, 728], [call("recipeStartingRules")], [], []]);
    expect(ok(invokeCallable(examples[0]!.function, examples[0]!.arguments, context)).funnel)
      .toEqual({ $tag: "RecipeChooseSeveral", recipeIds: ["chickpea-bowl", "tomato-toast"] });
  });

  test("inclusive windows select several, one or no recipes with unchanged recipe data", () => {
    const several = ok(call("recipesInWindow", 720, 732));
    const one = ok(call("recipesInWindow", 720, 728));
    const none = ok(call("recipesInWindow", 720, 725));
    expect(ids(several)).toEqual(["chickpea-bowl", "tomato-toast"]);
    expect(reason(several, "chickpea-bowl", "RecipeScheduleFits").passed).toBe(true);
    expect(ids(one)).toEqual(["tomato-toast"]);
    expect(one.funnel).toEqual({ $tag: "RecipeOfferOne", recipeId: "tomato-toast" });
    expect(reason(one, "tomato-toast", "RecipeScheduleFits").passed).toBe(true);
    expect(ids(none)).toEqual([]);
    expect(none.funnel).toMatchObject({ $tag: "RecipeAdjustInputs" });
    expect(none.input.recipes).toEqual(one.input.recipes);
    expect(ok(call("recipesInWindow", 0, 1440)).availableMinutes).toBe(1440);
    expect(ids(ok(call("recipesInWindow", 1440, 1440)))).toEqual([]);
  });

  test("independent rule edits update the named reasons and their derived branch", () => {
    const rules = initial().rules;
    const any = ok(call("recipesWithRules", { ...rules, ingredientPolicy: { $tag: "RecipeAnyIngredients" } }));
    expect(ids(any)).toEqual(["chickpea-bowl", "tomato-toast", "egg-toast"]);
    expect(reason(any, "egg-toast", "RecipePreferenceMatches")).toMatchObject({ passed: true, affectedFoodIds: [] });
    const maximumEight = ok(call("recipesWithRules", { ...rules, maximumPreparationMinutes: 8 }));
    expect(ids(maximumEight)).toEqual(["tomato-toast"]);
    expect(reason(maximumEight, "tomato-toast", "RecipeMaximumFits").passed).toBe(true);
    expect(reason(maximumEight, "chickpea-bowl", "RecipeMaximumFits").passed).toBe(false);
    expect(ids(ok(call("recipesWithRules", { ...rules, maximumPreparationMinutes: 7 })))).toEqual([]);
    const excluded = ok(call("recipesWithRules", { ...rules, excludedFoodIds: ["tomato"] }));
    expect(ids(excluded)).toEqual([]);
    expect(reason(excluded, "chickpea-bowl", "RecipeExclusionsAllowed")).toMatchObject({ passed: false, affectedFoodIds: ["tomato"] });
    expect(reason(excluded, "tomato-toast", "RecipeExclusionsAllowed")).toMatchObject({ passed: false, affectedFoodIds: ["tomato"] });
  });

  test("pantry and catalogue edits preserve exact food identity and source order", () => {
    const missing = initial();
    missing.availableFoodIds = missing.availableFoodIds.filter(id => id !== "tomato");
    const missingPlan = ok(call("planRecipes", missing));
    expect(ids(missingPlan)).toEqual([]);
    expect(reason(missingPlan, "chickpea-bowl", "RecipePantryAvailable")).toMatchObject({ passed: false, affectedFoodIds: ["tomato"] });
    expect(reason(missingPlan, "tomato-toast", "RecipePantryAvailable")).toMatchObject({ passed: false, affectedFoodIds: ["tomato"] });
    const regrouped = initial();
    regrouped.foods.find(food => food.id === "egg")!.kind = { $tag: "RecipePlant" };
    expect(ids(ok(call("planRecipes", regrouped)))).toEqual(["chickpea-bowl", "tomato-toast", "egg-toast"]);
    const reversed = initial();
    reversed.recipes.reverse();
    const ordered = ok(call("planRecipes", reversed));
    expect(ordered.decisions.map(decision => decision.recipe.id)).toEqual(["chicken-rice", "egg-toast", "tomato-toast", "chickpea-bowl"]);
    expect(ids(ordered)).toEqual(["tomato-toast", "chickpea-bowl"]);
    expect(ordered.funnel).toEqual({ $tag: "RecipeChooseSeveral", recipeIds: ["tomato-toast", "chickpea-bowl"] });
  });

  test("unknown recipe ingredients remain explained while unrelated recipes still qualify", () => {
    const input = initial();
    input.recipes[0]!.ingredientIds = ["tomato", "unknown-food"];
    const plan = ok(call("planRecipes", input));
    expect(ids(plan)).toEqual(["tomato-toast"]);
    expect(plan.decisions[0]!.recipe.ingredientIds).toEqual(["tomato", "unknown-food"]);
    expect(reason(plan, "chickpea-bowl", "RecipeCatalogueKnown")).toMatchObject({ passed: false, affectedFoodIds: ["unknown-food"] });
    expect(reason(plan, "chickpea-bowl", "RecipePantryAvailable")).toMatchObject({ passed: false, affectedFoodIds: ["unknown-food"] });
    expect(reason(plan, "chickpea-bowl", "RecipePreferenceMatches")).toMatchObject({ passed: false, affectedFoodIds: ["unknown-food"] });
    input.rules.ingredientPolicy = { $tag: "RecipeAnyIngredients" };
    const any = ok(call("planRecipes", input));
    expect(ids(any)).toEqual(["tomato-toast", "egg-toast"]);
    expect(reason(any, "chickpea-bowl", "RecipePreferenceMatches").passed).toBe(true);
    expect(reason(any, "chickpea-bowl", "RecipeCatalogueKnown").passed).toBe(false);
  });

  test("empty ingredients fail their named rule; empty catalogues and zero-minute recipes are explicit", () => {
    const emptyRecipe = initial();
    emptyRecipe.recipes[0]!.ingredientIds = [];
    const plan = ok(call("planRecipes", emptyRecipe));
    expect(plan.decisions[0]!.reasons.map(entry => entry.passed)).toEqual([false, true, true, true, true, true, true]);
    expect(ids(plan)).toEqual(["tomato-toast"]);
    const empty = initial();
    empty.foods = [];
    empty.recipes = [];
    empty.availableFoodIds = [];
    const emptyPlan = ok(call("planRecipes", empty));
    expect(emptyPlan.decisions).toEqual([]);
    expect(emptyPlan.eligibleRecipes).toEqual([]);
    expect(emptyPlan.funnel).toMatchObject({ $tag: "RecipeAdjustInputs" });
    const zero = initial();
    zero.recipes = [{ ...zero.recipes[0]!, preparationMinutes: 0 }];
    zero.rules.maximumPreparationMinutes = 0;
    zero.schedule = { $tag: "RecipeSchedule", startMinute: 1440, finishMinute: 1440 };
    expect(ids(ok(call("planRecipes", zero)))).toEqual(["chickpea-bowl"]);
  });

  test("catalogue, pantry, exclusion and ingredient carriers refuse and recover", () => {
    const carriers = [undefined, null, {}, "", "tomato", 7, false, { length: 0 }, { 0: "tomato", length: 1 }];
    for (const carrier of carriers) {
      for (const field of ["foods", "recipes", "availableFoodIds"] as const) {
        const input = initial();
        input.foods = [];
        input.recipes = [];
        input.availableFoodIds = [];
        input[field] = carrier as never;
        expect(call("recipePlanAdmitted", input)).toBe(false);
        refused(call("planRecipes", input));
      }
      const exclusions = initial();
      exclusions.rules.excludedFoodIds = carrier as never;
      expect(call("recipePlanAdmitted", exclusions)).toBe(false);
      refused(call("planRecipes", exclusions));
      refused(call("recipesWithRules", exclusions.rules));
      const ingredients = initial();
      ingredients.recipes[0]!.ingredientIds = carrier as never;
      expect(call("recipeDefinitionAdmitted", ingredients.recipes[0])).toBe(false);
      expect(call("recipePlanAdmitted", ingredients)).toBe(false);
      refused(call("planRecipes", ingredients));
      expect(ids(ok(call("planRecipes", initial())))).toEqual(["chickpea-bowl", "tomato-toast"]);
    }
  });

  test.each([
    ["duplicate food id", (input: Input) => { input.foods.push({ ...input.foods[0]! }); }],
    ["duplicate recipe id", (input: Input) => { input.recipes.push({ ...input.recipes[0]! }); }],
    ["duplicate ingredient id", (input: Input) => { input.recipes[0]!.ingredientIds.push("tomato"); }],
    ["duplicate pantry id", (input: Input) => { input.availableFoodIds.push("tomato"); }],
    ["duplicate exclusion id", (input: Input) => { input.rules.excludedFoodIds = ["tomato", "tomato"]; }],
    ["unknown pantry id", (input: Input) => { input.availableFoodIds.push("unknown-food"); }],
    ["unknown exclusion id", (input: Input) => { input.rules.excludedFoodIds = ["unknown-food"]; }],
    ["empty food id", (input: Input) => { input.foods[0]!.id = ""; }],
    ["long food id", (input: Input) => { input.foods[0]!.id = "x".repeat(65); }],
    ["empty food name", (input: Input) => { input.foods[0]!.name = ""; }],
    ["long food name", (input: Input) => { input.foods[0]!.name = "x".repeat(81); }],
    ["long food notes", (input: Input) => { input.foods[0]!.notes = "x".repeat(241); }],
    ["empty recipe id", (input: Input) => { input.recipes[0]!.id = ""; }],
    ["long recipe id", (input: Input) => { input.recipes[0]!.id = "x".repeat(65); }],
    ["empty recipe name", (input: Input) => { input.recipes[0]!.name = ""; }],
    ["long recipe name", (input: Input) => { input.recipes[0]!.name = "x".repeat(81); }],
    ["empty ingredient id", (input: Input) => { input.recipes[0]!.ingredientIds = [""]; }],
    ["long ingredient id", (input: Input) => { input.recipes[0]!.ingredientIds = ["x".repeat(65)]; }],
    ["unsupported food kind", (input: Input) => { input.foods[0]!.kind = { $tag: "Unclassified" } as unknown as Kind; }],
    ["unsupported preference", (input: Input) => { input.rules.ingredientPolicy = { $tag: "Unclassified" } as unknown as Rules["ingredientPolicy"]; }],
  ])("invalid catalogue metadata refuses the entire plan: %s", (_label, edit) => {
    const input = initial();
    edit(input);
    refused(call("planRecipes", input));
  });

  test("whole finite minute bounds apply to every preparation and schedule field", () => {
    for (const minutes of [-1, 0.5, 241, NaN, Infinity, -Infinity]) {
      const recipe = initial();
      recipe.recipes[0]!.preparationMinutes = minutes;
      refused(call("planRecipes", recipe));
      const maximum = initial();
      maximum.rules.maximumPreparationMinutes = minutes;
      refused(call("planRecipes", maximum));
    }
    for (const minute of [-1, 0.5, 1441, NaN, Infinity, -Infinity]) {
      for (const endpoint of ["startMinute", "finishMinute"] as const) {
        const input = initial();
        input.schedule[endpoint] = minute;
        refused(call("planRecipes", input));
      }
    }
    refused(call("recipesInWindow", 721, 720));
    const input = initial();
    input.recipes = [{ ...input.recipes[0]!, preparationMinutes: 240 }];
    input.rules.maximumPreparationMinutes = 240;
    input.schedule = { $tag: "RecipeSchedule", startMinute: 1200, finishMinute: 1440 };
    expect(ids(ok(call("planRecipes", input)))).toEqual(["chickpea-bowl"]);
  });

  test("row, ingredient and text caps admit their inclusive edge then refuse overflow", () => {
    const input = initial();
    input.foods = Array.from({ length: 24 }, (_, index): Food => ({
      $tag: "RecipeFood", id: `food-${index}`, name: "x".repeat(80), kind: { $tag: "RecipePlant" }, notes: "x".repeat(240),
    }));
    input.availableFoodIds = input.foods.map(food => food.id);
    input.recipes = Array.from({ length: 12 }, (_, index): Recipe => ({
      $tag: "RecipeDefinition", id: index === 0 ? "r".repeat(64) : `recipe-${index}`,
      name: "x".repeat(80), ingredientIds: input.availableFoodIds.slice(0, 12), preparationMinutes: 12,
    }));
    const edge = ok(call("planRecipes", input));
    expect(edge.decisions).toHaveLength(12);
    expect(edge.eligibleRecipes).toHaveLength(12);
    const before = structuredClone(input);
    input.rules.excludedFoodIds = [...input.availableFoodIds];
    expect(ids(ok(call("planRecipes", input)))).toEqual([]);
    input.rules.excludedFoodIds.push("overflow");
    refused(call("planRecipes", input));
    const tooManyFoods = structuredClone(before);
    tooManyFoods.foods.push({ ...tooManyFoods.foods[0]!, id: "overflow" });
    refused(call("planRecipes", tooManyFoods));
    const tooManyRecipes = structuredClone(before);
    tooManyRecipes.recipes.push({ ...tooManyRecipes.recipes[0]!, id: "overflow" });
    refused(call("planRecipes", tooManyRecipes));
    const tooManyIngredients = structuredClone(before);
    tooManyIngredients.recipes[0]!.ingredientIds = before.availableFoodIds.slice(0, 13);
    refused(call("planRecipes", tooManyIngredients));
    const tooManyAvailable = structuredClone(before);
    tooManyAvailable.availableFoodIds.push("overflow");
    refused(call("planRecipes", tooManyAvailable));
  }, 60_000);
});
