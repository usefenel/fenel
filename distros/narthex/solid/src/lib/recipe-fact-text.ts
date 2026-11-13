// Display glue for the recipe card (recipe-facts-view.tsx): the words of a
// fact whose summary is a count range. The range itself is Fenel's
// (recipe-criteria.fenel, IngredientCount); this only phrases it.

/** "4 foods", "1 food", "2 to 3 foods" for an IngredientCount summary;
 * undefined for any other value. */
export function ingredientCountText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { $tag?: unknown; minimum?: unknown; maximum?: unknown };
  if (record.$tag !== "IngredientCount") return undefined;
  const { minimum, maximum } = record;
  if (typeof minimum !== "number" || typeof maximum !== "number") return undefined;
  const foods = (count: number) => count === 1 ? "food" : "foods";
  return minimum === maximum ? `${minimum} ${foods(minimum)}` : `${minimum} to ${maximum} ${foods(maximum)}`;
}

const FINDING_VERDICTS: ReadonlyArray<readonly [string, string]> = [
  ["RecipeYes", "Yes"], ["RecipeNo", "No"], ["RecipeNoPreparation", "No preparation"], ["RecipeUnknown", "Unknown"],
];

/** A "family findings" row (a list of RecipeFinding: a category and its
 * verdict) as groups of categories under one verdict word, in the verdicts'
 * order; undefined when the list is not findings. The categories keep their
 * own values (and glyphs); the verdicts are Fenel's. */
export function findingGroups(value: unknown): Array<{ verdict: string; categories: unknown[] }> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tags = new Map(FINDING_VERDICTS);
  const groups = new Map<string, unknown[]>();
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const tag = (item as { $tag?: unknown }).$tag;
    const category = (item as { category?: unknown }).category;
    if (typeof tag !== "string" || !tags.has(tag) || category === undefined) return undefined;
    groups.set(tag, [...(groups.get(tag) ?? []), category]);
  }
  return FINDING_VERDICTS.filter(([tag]) => groups.has(tag)).map(([tag, verdict]) => ({ verdict, categories: groups.get(tag)! }));
}

/** A "Substitutes" row (a list of RecipeAlternative: a condition, its foods
 * and a witness) as the witness preparation of each alternative, so it reads
 * as rows of food pictures; undefined when the list is not alternatives. The
 * alternatives and their witnesses are Fenel's. */
export function alternativePreparations(value: unknown): unknown[][] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const rows: unknown[][] = [];
  for (const item of value) {
    const witness = item && typeof item === "object" ? (item as { witnessPreparation?: unknown }).witnessPreparation : undefined;
    if (!Array.isArray(witness) || !("condition" in (item as object))) return undefined;
    rows.push(witness);
  }
  return rows;
}

/** Which tile opens a fact's value, so its label sits on that tile's first
 * line (Rom, Nov 13: labels at the top of their row): "captioned" for
 * findings (the verdict word is the tile's corner caption), "strip" for a list
 * of foods or of preparations (a row of circles), "text" for anything else.
 * Same precedence as the card's value renderer. */
export function recipeValueLead(value: unknown): "captioned" | "strip" | "text" {
  if (findingGroups(value)) return "captioned";
  if (Array.isArray(value) || alternativePreparations(value)) return "strip";
  return "text";
}
