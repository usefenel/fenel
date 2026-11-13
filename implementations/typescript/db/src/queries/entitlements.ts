// Entitlement queries — read from entity_instances (entity_type='entitlement').
// As of 9b-Q the bespoke entitlements_granted table is gone.

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

type EntitlementRow = {
  id: string;
  accountId: string;
  profileId: string;
  entitlementSlug: string;
  itemId: string | null;
  grantedByPurchaseId: string | null;
  grantedByStep: string | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  graceEndsAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): EntitlementRow {
  const d = (row.data ?? {}) as Record<string, unknown>;
  const dateOr = (k: string) => (d[k] ? new Date(d[k] as string) : null);
  return {
    id: row.id,
    accountId: row.accountId,
    profileId: (d.profileId as string) ?? "",
    entitlementSlug: (d.entitlementSlug as string) ?? "",
    itemId: (d.itemId as string | null) ?? null,
    grantedByPurchaseId: (d.grantedByPurchaseId as string | null) ?? null,
    grantedByStep: (d.grantedByStep as string | null) ?? null,
    startsAt: dateOr("startsAt"),
    expiresAt: dateOr("expiresAt"),
    graceEndsAt: dateOr("graceEndsAt"),
    revokedAt: dateOr("revokedAt"),
    revokedReason: (d.revokedReason as string | null) ?? null,
    payload: (d.payload as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}

export async function getProfileEntitlements(accountId: string, profileId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "entitlement"),
        sql`${entityInstances.data}->>'profileId' = ${profileId}`,
        sql`${entityInstances.data}->>'revokedAt' IS NULL`,
      ),
    );
  return rows.map(flatten);
}

export async function checkProfileAccess(
  accountId: string,
  profileId: string,
  itemSlug: string,
): Promise<boolean> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  // Resolve itemSlug → itemId (in entity_instances).
  const [item] = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "item"),
        sql`${entityInstances.data}->>'slug' = ${itemSlug}`,
      ),
    )
    .limit(1);

  if (!item) return false;

  // Active entitlement if: revokedAt IS NULL AND
  //   (expiresAt IS NULL OR expiresAt >= now OR graceEndsAt >= now).
  const results = await db
    .select({ id: entityInstances.id })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "entitlement"),
        sql`${entityInstances.data}->>'profileId' = ${profileId}`,
        sql`${entityInstances.data}->>'itemId' = ${item.id}`,
        sql`${entityInstances.data}->>'revokedAt' IS NULL`,
        sql`(
          ${entityInstances.data}->>'expiresAt' IS NULL
          OR ${entityInstances.data}->>'expiresAt' >= ${nowIso}
          OR ${entityInstances.data}->>'graceEndsAt' >= ${nowIso}
        )`,
      ),
    )
    .limit(1);

  return results.length > 0;
}

export async function findEntitlementById(entitlementId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, entitlementId),
        eq(entityInstances.entityType, "entitlement"),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

// Backward-compat aliases
export const getLeadEntitlements = getProfileEntitlements;
export const checkLeadAccess = checkProfileAccess;
