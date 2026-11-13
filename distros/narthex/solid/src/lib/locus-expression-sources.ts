import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { LocusRootData } from "./locus-root-data";
import { cardConstructorKey, cardTypeOrdinal } from "./card-type-ordinal";
import { NOT_DATA, dataOfNode } from "./expression-runner/simple-data-form-model";

/** `unnamed`: a root card without a caption; its `name` is the generic
 * "<root> / Value". `ordinal`: its place among the root's cards built by the
 * same constructor, as its card heading numbers it ("Person 1"). */
export type ExpressionSource = { id: string; name: string; expr: ExprNode; unnamed?: boolean; ordinal?: number };

/** Every expression editor uses the same account-root reference namespace.
 * The caller supplies an already-authorized snapshot; resolving an unknown id
 * never fetches another account or falls back to a process-global registry. */
export function locusExpressionSources(root: LocusRootData | null | undefined): ExpressionSource[] {
  if (!root) return [];
  const names = new Map<string, string>([[root.referenceId, root.name]]);
  const unnamed = new Map<string, number | undefined>();
  const itemKey = (id: string) => `${root.referenceId}:${id}`;
  // The card's own key: its data's constructor, through a reference to saved data.
  const itemExpr = (id: string): ExprNode | undefined => {
    const expr = root.expressions[itemKey(id)];
    return expr?.kind === "ref" ? root.expressions[expr.savedExprId] ?? expr : expr;
  };
  for (const item of root.items) {
    names.set(itemKey(item.id), `${root.name} / ${item.caption || "Value"}`);
    if (!item.caption) unnamed.set(itemKey(item.id), cardTypeOrdinal(root.items, item, (card) => cardConstructorKey(itemExpr(card.id))));
  }
  for (const list of root.lists) {
    names.set(list.referenceId, `${root.name} / ${list.name}`);
    if (list.sourceReferenceId) names.set(list.sourceReferenceId, `${root.name} / ${list.name} / Source`);
  }
  return Object.entries(root.expressions).map(([id, expr]) => {
    const source: ExpressionSource = { id, name: names.get(id) ?? "Value", expr };
    if (unnamed.has(id)) {
      source.unnamed = true;
      const ordinal = unnamed.get(id);
      if (ordinal !== undefined) source.ordinal = ordinal;
    }
    return source;
  });
}

export function expressionSourceIndex(sources: readonly ExpressionSource[]): Map<string, ExpressionSource> {
  return new Map(sources.map((source) => [source.id, source]));
}

/** The saved values a picker offers: the root's own references, then the
 * saved values themselves. A Local tab also publishes each saved value's
 * expression under its own id (so references to it resolve); that entry is
 * the same saved value and is listed once, under its name, never again as an
 * unnamed "Value" (polish lane 2, Nov 9: two phantom "Value" rows above
 * Alex and Sam in the saved-Person picker). */
export function savedValueOptions(root: LocusRootData | null | undefined,
  saved: readonly ExpressionSource[]): ExpressionSource[] {
  const savedIds = new Set(saved.map((value) => value.id));
  return [...locusExpressionSources(root).filter((source) => !savedIds.has(source.id)), ...saved];
}

/** The name a typed picker shows for a saved value (launch night, Nov 13: a
 * Person made from its type card was listed as "Local / Value"). An unnamed
 * card reads as its card heading does, the picked type's label and its place
 * among that type's cards ("Person 1"); a named value keeps its name. */
export function savedValueShownName(option: Pick<ExpressionSource, "name" | "unnamed" | "ordinal">,
  typeLabel?: string): string {
  const label = typeLabel?.trim();
  return option.unnamed && label && option.ordinal !== undefined ? `${label} ${option.ordinal}` : option.name;
}

function dataText(data: unknown, out: string[], depth = 0): void {
  if (depth > 12 || data === null || data === undefined) return;
  if (typeof data === "string") { out.push(data); return; }
  if (typeof data === "number" || typeof data === "bigint") { out.push(String(data)); return; }
  if (typeof data !== "object") return;
  for (const value of Array.isArray(data) ? data : Object.values(data)) dataText(value, out, depth + 1);
}

/** A picker search matches the shown name, or the text of the value's own
 * authored data (searching "Rom" finds the Person whose name is Rom). */
export function savedValueMatches(option: Pick<ExpressionSource, "name" | "unnamed" | "ordinal" | "expr">,
  query: string, typeLabel?: string, resolve?: (savedExprId: string) => ExprNode | undefined): boolean {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  if (savedValueShownName(option, typeLabel).toLowerCase().includes(wanted)) return true;
  const expr = option.expr.kind === "ref" ? resolve?.(option.expr.savedExprId) : option.expr;
  if (!expr) return false;
  const data = dataOfNode(expr);
  if (data === NOT_DATA) return false;
  const texts: string[] = [];
  dataText(data, texts);
  return texts.some((text) => text.toLowerCase().includes(wanted));
}
