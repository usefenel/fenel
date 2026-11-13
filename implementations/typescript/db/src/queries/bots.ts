// ---------------------------------------------------------------------------
// Bot queries — bot rows are persisted as `entity_instances` (entity_type =
// "Bot"), matching the Fenel `Bot` system entity declared in
// `implementations/typescript/engine/src/system-entities.ts`. The flat `bots` table is gone;
// this module flattens entity_instances rows back into the historic bot
// row shape so callers see the same surface as before. New consumers
// should generally route through `entity_query` / `entity_instances`
// directly — these helpers exist to keep the runtime handler / webhook
// route concise.
// ---------------------------------------------------------------------------

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../client";
import { entityInstances } from "../schema/entity-instances";

const BOT_ENTITY_TYPE = "Bot";

/** The flattened bot record — same shape the old `bots` table exposed.
 *  All non-id/account fields live in entity_instances.data; this view
 *  pulls them up to the top level for caller ergonomics. */
export type BotRow = {
  id: string;
  accountId: string;
  platform: "telegram";
  label: string | null;
  username: string | null;
  token: string;
  telegramBotId: number | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
  collectorConfig: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Flatten an entity_instances row into the BotRow shape. */
function flatten(row: typeof entityInstances.$inferSelect): BotRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    accountId: row.accountId,
    platform: (data["platform"] as "telegram") ?? "telegram",
    label: (data["label"] as string | undefined) ?? null,
    username: (data["username"] as string | undefined) ?? null,
    token: (data["token"] as string) ?? "",
    telegramBotId:
      typeof data["telegramBotId"] === "number"
        ? (data["telegramBotId"] as number)
        : null,
    webhookSecret: (data["webhookSecret"] as string | undefined) ?? null,
    webhookUrl: (data["webhookUrl"] as string | undefined) ?? null,
    collectorConfig:
      data["collectorConfig"] != null
        ? (data["collectorConfig"] as Record<string, unknown>)
        : null,
    enabled: data["enabled"] !== false, // default true
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findBotById(
  accountId: string,
  id: string,
): Promise<BotRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        eq(entityInstances.id, id),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

/** Look up a bot by its UUID alone — used by the webhook route, which
 *  receives the bot's id in the URL path before the account is known. The
 *  webhook handler uses the resulting `accountId` for downstream
 *  `processEvent` dispatch. */
export async function findBotByIdGlobal(id: string): Promise<BotRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        eq(entityInstances.id, id),
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function listBotsByAccount(
  accountId: string,
): Promise<BotRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        // enabled defaults to true — only filter out explicit false
        sql`COALESCE(${entityInstances.data}->>'enabled', 'true') <> 'false'`,
      ),
    );
  return rows.map(flatten);
}

export async function findBotByTelegramBotId(
  accountId: string,
  telegramBotId: number,
): Promise<BotRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.accountId, accountId),
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        sql`(${entityInstances.data}->>'telegramBotId')::bigint = ${telegramBotId}`,
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function findBotByToken(token: string): Promise<BotRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        sql`${entityInstances.data}->>'token' = ${token}`,
      ),
    )
    .limit(1);
  return row ? flatten(row) : null;
}

export async function upsertBot(row: {
  accountId: string;
  token: string;
  telegramBotId?: number;
  username?: string;
  label?: string;
  collectorConfig?: Record<string, unknown>;
}): Promise<BotRow> {
  const db = getDb();
  const existing = await findBotByToken(row.token);
  if (existing) {
    // Merge new fields into the existing data blob.
    const merged: Record<string, unknown> = {
      platform: existing.platform,
      label: existing.label,
      username: existing.username,
      token: existing.token,
      telegramBotId: existing.telegramBotId,
      webhookSecret: existing.webhookSecret,
      webhookUrl: existing.webhookUrl,
      collectorConfig: existing.collectorConfig,
      enabled: existing.enabled,
    };
    if (row.username !== undefined) merged["username"] = row.username;
    if (row.label !== undefined) merged["label"] = row.label;
    if (row.telegramBotId !== undefined) merged["telegramBotId"] = row.telegramBotId;
    if (row.collectorConfig !== undefined) merged["collectorConfig"] = row.collectorConfig;
    // Strip nulls so JSONB stays clean.
    const data = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== null && v !== undefined),
    );
    const [updated] = await db
      .update(entityInstances)
      .set({ data, updatedAt: new Date() })
      .where(eq(entityInstances.id, existing.id))
      .returning();
    return flatten(updated!);
  }
  const data: Record<string, unknown> = {
    platform: "telegram",
    token: row.token,
    enabled: true,
  };
  if (row.username !== undefined) data["username"] = row.username;
  if (row.label !== undefined) data["label"] = row.label;
  if (row.telegramBotId !== undefined) data["telegramBotId"] = row.telegramBotId;
  if (row.collectorConfig !== undefined) data["collectorConfig"] = row.collectorConfig;
  const [inserted] = await db
    .insert(entityInstances)
    .values({
      // storage-as-effect D3 — mint the id app-side (the `entity_instances.id`
      // DEFAULT is dropped in migration 0087); this direct inserter is one of
      // the non-`state:*` sites that must supply it.
      id: crypto.randomUUID(),
      accountId: row.accountId,
      entityType: BOT_ENTITY_TYPE,
      data,
    })
    .returning();
  return flatten(inserted!);
}

/** Patch fields on a bot row — used for partial updates that previously
 *  ran as raw `db.update(botsTable).set({...})`. Reads existing data,
 *  shallow-merges the provided fields, writes back. Pass `null` for a
 *  field to clear it. */
export async function updateBotFields(
  id: string,
  fields: Partial<{
    label: string | null;
    username: string | null;
    token: string;
    telegramBotId: number | null;
    webhookSecret: string | null;
    webhookUrl: string | null;
    collectorConfig: Record<string, unknown> | null;
    enabled: boolean;
  }>,
): Promise<BotRow | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(entityInstances)
    .where(
      and(
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        eq(entityInstances.id, id),
      ),
    )
    .limit(1);
  if (!existing) return null;
  const currentData = (existing.data ?? {}) as Record<string, unknown>;
  const nextData: Record<string, unknown> = { ...currentData };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (v === null) {
      delete nextData[k];
    } else {
      nextData[k] = v;
    }
  }
  const [updated] = await db
    .update(entityInstances)
    .set({ data: nextData, updatedAt: new Date() })
    .where(eq(entityInstances.id, id))
    .returning();
  return updated ? flatten(updated) : null;
}

/** Delete a bot row entirely. Used when teardown should remove the
 *  registration rather than just clearing collectorConfig. */
export async function deleteBot(id: string): Promise<void> {
  const db = getDb();
  await db
    .delete(entityInstances)
    .where(
      and(
        eq(entityInstances.entityType, BOT_ENTITY_TYPE),
        eq(entityInstances.id, id),
      ),
    );
}
