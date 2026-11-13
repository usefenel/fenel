// The recipe card's "Ingredient count" row read as a record of two numbers
// (minimum, maximum) drawn by the structural reader. It now reads as words.
//   bun test --timeout 60000 ./distros/narthex/solid/src/lib/recipe-fact-text.test.ts
import { expect, test } from "bun:test";
import { alternativePreparations, findingGroups, ingredientCountText, recipeValueLead } from "./recipe-fact-text";

test("an ingredient count reads as a number of foods; other values are not phrased", () => {
  expect(ingredientCountText({ $tag: "IngredientCount", minimum: 4, maximum: 4 })).toBe("4 foods");
  expect(ingredientCountText({ $tag: "IngredientCount", minimum: 2, maximum: 3 })).toBe("2 to 3 foods");
  expect(ingredientCountText({ $tag: "IngredientCount", minimum: 1, maximum: 1 })).toBe("1 food");
  expect(ingredientCountText({ $tag: "Foods", items: [] })).toBeUndefined();
  expect(ingredientCountText([{ $tag: "Butter" }])).toBeUndefined();
  expect(ingredientCountText(undefined)).toBeUndefined();
});

// The two "family findings" rows drew each finding (RecipeYes { category }) as
// a cube with its constructor name. They now group the categories by verdict.
test("family findings group their categories under a verdict word; other lists are not findings", () => {
  const dairy = { $tag: "DairyFood" }, plant = { $tag: "PlantFood" }, fruit = { $tag: "FruitFood" };
  expect(findingGroups([{ $tag: "RecipeNo", category: fruit }, { $tag: "RecipeYes", category: dairy }, { $tag: "RecipeYes", category: plant }]))
    .toEqual([{ verdict: "Yes", categories: [dairy, plant] }, { verdict: "No", categories: [fruit] }]);
  expect(findingGroups([{ $tag: "RecipeUnknown", category: fruit, reasons: [] }])).toEqual([{ verdict: "Unknown", categories: [fruit] }]);
  expect(findingGroups([{ $tag: "Butter" }])).toBeUndefined();
  expect(findingGroups([])).toBeUndefined();
  expect(findingGroups([[{ $tag: "Butter" }]])).toBeUndefined();
});

// The "Substitutes" row drew each alternative (a record with a symbolic
// condition) as a cube. It now reads as each alternative's witness preparation.
test("alternatives read as their witness preparations; other lists are not alternatives", () => {
  const butter = { $tag: "Butter" }, coconut = { $tag: "CoconutCream" }, honey = { $tag: "Honey" };
  const alternative = (foods: unknown[]) => ({ $tag: "RecipeAlternative", condition: { $tag: "RcAll" }, foods: [], witnessPantry: foods, witnessPreparation: foods });
  expect(alternativePreparations([alternative([butter, honey]), alternative([coconut, honey])])).toEqual([[butter, honey], [coconut, honey]]);
  expect(alternativePreparations([{ $tag: "RecipeYes", category: butter }])).toBeUndefined();
  expect(alternativePreparations([])).toBeUndefined();
});

test("a fact's value leads with a captioned tile (findings), a strip (lists, preparations) or text", () => {
  expect(recipeValueLead([{ $tag: "RecipeYes", category: { $tag: "PlantFood" } }])).toBe("captioned");
  expect(recipeValueLead([{ $tag: "Butter" }, { $tag: "Honey" }])).toBe("strip");
  expect(recipeValueLead([[{ $tag: "Butter" }], [{ $tag: "Honey" }]])).toBe("strip");
  expect(recipeValueLead([{ condition: { $tag: "Always" }, witnessPreparation: [{ $tag: "Egg" }] }])).toBe("strip");
  expect(recipeValueLead([])).toBe("strip");
  expect(recipeValueLead({ $tag: "IngredientCount", minimum: 4, maximum: 4 })).toBe("text");
  expect(recipeValueLead({ $tag: "NoSuccessfulPreparation" })).toBe("text");
});
