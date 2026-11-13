// ---------------------------------------------------------------------------
// Profile queries — profile entity + profile-relations all live in
// entity_instances. As of 9b-P, the bespoke relation tables are gone;
// queries hit entity_instances filtered by entity_type.
// ---------------------------------------------------------------------------

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

type ProfileRow = {
  id: string;
  accountId: string;
  type: string;
  gender: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  avatar: string | null;
  notes: string | null;
  firstName: string | null;
  lastName: string | null;
  nicknames: string[] | null;
  archivedAt: Date | null;
  createdAt: Date;
};

function flatten(row: typeof entityInstances.$inferSelect): ProfileRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const archivedAt = data.archivedAt ? new Date(data.archivedAt as string) : null;
  return {
    id: row.id,
    accountId: row.accountId,
    type: (data.type as string) ?? "person",
    gender: (data.gender as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    dob: (data.dob as string | null) ?? null,
    avatar: (data.avatar as string | null) ?? null,
    notes: (data.notes as string | null) ?? null,
    firstName: (data.firstName as string | null) ?? null,
    lastName: (data.lastName as string | null) ?? null,
    nicknames: (data.nicknames as string[] | null) ?? null,
    archivedAt,
    createdAt: row.createdAt,
  };
}

export async function findProfileByHandle(
  accountId: string,
  platform: string,
  handle: string,
) {
  const db = getDb();
  // profile_handle is its own entity type; data->>'profileId' points back.
  const [handleRow] = await db
    .select({ data: entityInstances.data })
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "profile_handle"),
        sql`${entityInstances.data}->>'platform' = ${platform}`,
        sql`${entityInstances.data}->>'handle' = ${handle}`,
      ),
    )
    .limit(1);
  if (!handleRow) return null;
  const profileId = (handleRow.data as Record<string, unknown>).profileId as string | undefined;
  if (!profileId) return null;

  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, profileId),
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "profile"),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function findProfileById(accountId: string, profileId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.id, profileId),
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "profile"),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function getProfileHandles(accountId: string, profileId: string): Promise<Array<{
  id: string;
  accountId: string;
  platform?: string;
  handle?: string;
  suspected?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  createdAt: Date;
  [key: string]: unknown;
}>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, "profile_handle"),
        sql`${entityInstances.data}->>'profileId' = ${profileId}`,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    ...(r.data as Record<string, unknown>),
    createdAt: r.createdAt,
  }));
}
