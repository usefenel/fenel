// ---------------------------------------------------------------------------
// Item queries — read through `entity_instances` (entity_type='item').
// FenelType-driven storage; no bespoke `items` table reads since 9b-C.
//
// Returned rows are flattened from { id, account_id, data: { slug, name,
// type, ... }, created_at } into the legacy { id, accountId, slug, name,
// type, config, createdAt } shape so downstream code that expected the
// old shape keeps working through the transition.
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

type ItemRow = {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  createdAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): ItemRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const { slug, name, type, ...rest } = data as { slug?: string; name?: string; type?: string };
  return {
    id: row.id,
    accountId: row.accountId,
    slug: (slug as string) ?? "",
    name: (name as string) ?? "",
    type: (type as string) ?? "",
    config: rest as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export async function findItemBySlug(accountId: string, slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "item"),
      ),
    );
  const match = rows.find((r) => (r.data as { slug?: string })?.slug === slug);
  return match ? flatten(match) : null;
}

export async function findItemById(accountId: string, itemId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.id, itemId),
        eq(entityInstances.entityType, "item"),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function listItemsByAccount(accountId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "item"),
      ),
    );
  return rows.map(flatten);
}
