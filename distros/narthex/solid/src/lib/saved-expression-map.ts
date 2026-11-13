import type { ExprNode } from "@fenel/engine/authoring/expression";
import type { FenelType, TypeScheme } from "@fenel/engine/types";
import { snapshotAuthoringSchemeTransport } from "@fenel/engine/inference-transport";

export type SavedExpressionDeclaration = { readonly type?: FenelType; readonly scheme?: TypeScheme };
const declarations = new WeakMap<ExprNode, SavedExpressionDeclaration>();

/** B3: declaration metadata belongs to this reader's exact saved source, not
 * to a shared callable object or a persisted authority token. A fresh root
 * distinguishes two saved aliases with different declarations. */
function declaredSource(source: ExprNode, declaration: SavedExpressionDeclaration): ExprNode {
  const copy = { ...source };
  declarations.set(copy, declaration.scheme ? { scheme: snapshotAuthoringSchemeTransport(declaration.scheme) }
    : declaration.type ? { type: snapshotAuthoringSchemeTransport({ quantified: [], body: declaration.type }).body } : declaration);
  return copy;
}

export function savedExpressionDeclaration(source: ExprNode): SavedExpressionDeclaration | undefined {
  return declarations.get(source);
}

export function restoreSavedExpressionDeclaration(source: ExprNode, declaration: SavedExpressionDeclaration): ExprNode {
  return declaredSource(source, declaration);
}

/** Worker transport contains data only. The actual reader rechecks every
 * type reference and complete callable contract before admission. */
export function savedExpressionDeclarationEntries(entries: readonly (readonly [string, ExprNode])[]): Array<readonly [string, SavedExpressionDeclaration]> {
  return entries.flatMap(([id, source]) => {
    const declaration = declarations.get(source);
    return declaration ? [[id, declaration] as const] : [];
  });
}

export function restoreSavedExpressionDeclarations(saved: Map<string, ExprNode>,
  entries: readonly (readonly [string, SavedExpressionDeclaration])[] | undefined): void {
  for (const [id, declaration] of entries ?? []) {
    const source = saved.get(id);
    if (source) saved.set(id, declaredSource(source, declaration));
  }
}

type QueryRow = { id: string; query?: unknown };

function parsed(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < 4 && typeof current === "string"; i++) {
    try { current = JSON.parse(current); } catch { return undefined; }
  }
  return current;
}

/** Saved rows are sometimes a JSON string wrapped around `{ expr }`. */
export function savedExpressionFromQuery(query: unknown): ExprNode | undefined {
  const record = parsed(query);
  if (!record || typeof record !== "object") return undefined;
  const expr = parsed((record as { expr?: unknown }).expr);
  if (expr && typeof expr === "object" && "kind" in expr) return expr as ExprNode;
  return undefined;
}
const shared = new WeakMap<object, WeakMap<object, Map<string, ExprNode>>>();
const emptyExpressions: Record<string, ExprNode> = Object.freeze({});
const emptyQueries: readonly QueryRow[] = Object.freeze([]);

/** One map for one saved library. Every lens over that library reads it. */
export function shareSavedExpressionMap(
  expressions: Record<string, ExprNode> | undefined,
  queries: readonly QueryRow[] | undefined,
): Map<string, ExprNode> {
  const rootKey = expressions ?? emptyExpressions;
  const queryKey = (queries ?? emptyQueries) as object;
  let byQuery = shared.get(rootKey);
  if (!byQuery) shared.set(rootKey, byQuery = new WeakMap());
  const existing = byQuery.get(queryKey);
  if (existing) return existing;
  const map = new Map<string, ExprNode>(Object.entries(expressions ?? {}));
  for (const query of queries ?? []) {
    const expr = savedExpressionFromQuery(query.query);
    if (expr) {
      const record = parsed(query.query) as { valueType?: FenelType } | undefined;
      const declaration = record?.valueType ? { type: record.valueType } : undefined;
      map.set(query.id, declaration ? declaredSource(expr, declaration) : expr);
    }
  }
  byQuery.set(queryKey, map);
  return map;
}
