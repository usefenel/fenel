// ---------------------------------------------------------------------------
// Inventory + reservation queries — both entity types live in
// entity_instances. As of 9b-S the bespoke reservations table is gone.
// ---------------------------------------------------------------------------

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

type InventoryRow = {
  id: string;
  accountId: string;
  slug: string;
  capacity: number;
  enforce: string;
  config: Record<string, unknown>;
  createdAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): InventoryRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const { slug, capacity, enforce, ...rest } = data as any;
  return {
    id: row.id,
    accountId: row.accountId,
    slug: (slug as string) ?? "",
    capacity: Number(capacity ?? 0),
    enforce: (enforce as string) ?? "soft",
    config: rest as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export async function findInventoryBySlug(accountId: string, slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "inventory"),
      ),
    );
  const match = rows.find((r) => (r.data as { slug?: string })?.slug === slug);
  return match ? flatten(match) : null;
}

export async function getInventoryStatus(accountId: string, slug: string) {
  const db = getDb();
  const inv = await findInventoryBySlug(accountId, slug);
  if (!inv) return null;

  // Active reservations: data->>'releasedAt' IS NULL.
  const activeReservations = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "reservation"),
        sql`${entityInstances.data}->>'inventoryId' = ${inv.id}`,
        sql`${entityInstances.data}->>'releasedAt' IS NULL`,
      ),
    );

  return {
    inventoryId: inv.id,
    slug: inv.slug,
    capacity: inv.capacity,
    reserved: activeReservations.length,
    available: inv.capacity - activeReservations.length,
    enforce: inv.enforce,
  };
}
