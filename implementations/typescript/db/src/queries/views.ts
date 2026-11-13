import { eq, and } from "drizzle-orm";
import { getDb } from "../client";
import { views } from "../schema/views";
import { viewDefinitionFromJsonWire, viewDefinitionToJsonWire } from "@fenel/engine/authoring/expression";

function decodedViewRow<T extends { view: Record<string, unknown> }>(row: T): T {
  return { ...row, view: viewDefinitionFromJsonWire(row.view) };
}

export async function listViews(accountId: string) {
  const db = getDb();
  const rows = await db.select().from(views).where(eq(views.accountId, accountId));
  return rows.map(decodedViewRow);
}

export async function getView(accountId: string, name: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(views)
    .where(and(eq(views.accountId, accountId), eq(views.name, name)))
    .limit(1);
  return row ? decodedViewRow(row) : null;
}

export async function upsertView(
  accountId: string,
  def: { name: string; view: Record<string, unknown> },
) {
  const db = getDb();
  const wire = viewDefinitionToJsonWire(def.view);
  const existing = await getView(accountId, def.name);
  if (existing) {
    const [updated] = await db
      .update(views)
      .set({ view: wire, updatedAt: new Date() })
      .where(eq(views.id, existing.id))
      .returning();
    return decodedViewRow(updated!);
  }
  const [created] = await db
    .insert(views)
    .values({ accountId, name: def.name, view: wire })
    .returning();
  return decodedViewRow(created!);
}

export async function deleteView(accountId: string, name: string) {
  const db = getDb();
  return db
    .delete(views)
    .where(and(eq(views.accountId, accountId), eq(views.name, name)));
}
