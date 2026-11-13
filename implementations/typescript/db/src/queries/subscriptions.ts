// ---------------------------------------------------------------------------
// Subscriptions query helpers.
//
// PR-S-3 cutover: writers and readers go through these helpers. Slugs
// are globally unique (the unified webhook ingress looks them up without
// an account prefix in the URL — the secret authenticates the call), so
// findSubscriptionBySlug needs only the slug. Per-account scans still
// pass accountId for index efficiency.
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import { getDb } from "../client";
import { subscriptions } from "../schema/subscriptions";

export async function listSubscriptionsForAccount(accountId: string) {
  const db = getDb();
  return db.select().from(subscriptions).where(eq(subscriptions.accountId, accountId));
}

/** Find one subscription by its globally-unique slug. */
export async function findSubscriptionBySlug(slug: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Active subscriptions for an event type — drives processEvent dispatch. */
export async function findSubscriptionsByEventType(accountId: string, eventType: string) {
  const db = getDb();
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.accountId, accountId),
        eq(subscriptions.source, "event"),
        eq(subscriptions.eventType, eventType),
        eq(subscriptions.enabled, true),
      ),
    );
}

/** All event-source subscriptions handled by a function (used by the
 *  dashboard's "function triggers" view). */
export async function listEventSubscriptionsByHandler(
  accountId: string,
  handlerFunctionId: string,
) {
  const db = getDb();
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.accountId, accountId),
        eq(subscriptions.source, "event"),
        eq(subscriptions.handlerFunctionId, handlerFunctionId),
      ),
    );
}

export async function getSubscriptionById(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .limit(1);
  return row ?? null;
}

export async function deleteSubscriptionById(accountId: string, id: string) {
  const db = getDb();
  const result = await db
    .delete(subscriptions)
    .where(
      and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
    )
    .returning({ id: subscriptions.id });
  return result.length > 0;
}

export async function upsertSubscription(row: {
  accountId: string;
  slug: string;
  source: "http_webhook" | "event" | "cron" | "signal";
  secret?: string | null;
  eventType?: string | null;
  cronExpr?: string | null;
  handlerFunctionId?: string | null;
  enabled?: boolean;
  metadata?: string | null;
}) {
  const db = getDb();
  // ⚠ THE LOOKUP IS ACCOUNT-SCOPED, and it was not (rights R2b review round 5).
  // `findSubscriptionBySlug` resolves across ALL accounts — correct for the
  // webhook ingress, which has only a slug — and this then updated BY ID, so an
  // upsert naming another account's slug silently rewrote that account's row:
  // its `secret`, its `source`, its `handlerFunctionId`, with `accountId` left
  // pointing at the victim. The webhook secret is what guards
  // `POST /webhooks/sub/:slug`, and that route dispatches under the ROW's lane
  // authority, so the rewrite was an inbound-event injection into another
  // account. Scoped, a foreign slug now falls through to the INSERT and meets
  // `subscriptions_slug_idx` — a loud unique-constraint failure instead of a
  // silent overwrite, which is the correct semantics for "this slug is taken".
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.slug, row.slug), eq(subscriptions.accountId, row.accountId)))
    .limit(1);
  if (existing) {
    const [updated] = await db
      .update(subscriptions)
      .set({
        source: row.source,
        secret: row.secret ?? null,
        eventType: row.eventType ?? null,
        cronExpr: row.cronExpr ?? null,
        handlerFunctionId: row.handlerFunctionId ?? null,
        enabled: row.enabled ?? existing.enabled,
        metadata: row.metadata ?? null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existing.id))
      .returning();
    return updated!;
  }
  const [inserted] = await db
    .insert(subscriptions)
    .values({
      accountId: row.accountId,
      slug: row.slug,
      source: row.source,
      secret: row.secret ?? null,
      eventType: row.eventType ?? null,
      cronExpr: row.cronExpr ?? null,
      handlerFunctionId: row.handlerFunctionId ?? null,
      enabled: row.enabled ?? true,
      metadata: row.metadata ?? null,
    })
    .returning();
  return inserted!;
}

export async function updateSubscriptionById(
  accountId: string,
  id: string,
  patch: {
    secret?: string | null;
    eventType?: string | null;
    cronExpr?: string | null;
    handlerFunctionId?: string | null;
    enabled?: boolean;
    metadata?: string | null;
  },
) {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.secret !== undefined) updates.secret = patch.secret;
  if (patch.eventType !== undefined) updates.eventType = patch.eventType;
  if (patch.cronExpr !== undefined) updates.cronExpr = patch.cronExpr;
  if (patch.handlerFunctionId !== undefined) updates.handlerFunctionId = patch.handlerFunctionId;
  if (patch.enabled !== undefined) updates.enabled = patch.enabled;
  if (patch.metadata !== undefined) updates.metadata = patch.metadata;
  const [updated] = await db
    .update(subscriptions)
    .set(updates)
    .where(
      and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
    )
    .returning();
  return updated ?? null;
}

/** ⚠ ACCOUNT-SCOPED, and it was not (rights R2b review round 5).
 *
 *  `subscriptions.slug` carries `subscriptions_slug_idx`, a GLOBALLY unique
 *  index, so a slug names exactly one row across every account — and this
 *  deleted by slug alone. `state:deleteSubscription` is in every role's general
 *  row (it argues no account, so no partition axis can reach it), which made it
 *  a one-argument cross-account delete for any caller that could name another
 *  account's slug. The sole caller already held `ctx.accountId` and was simply
 *  not passing it. The Fenel signature `(slug: String)` is unchanged: the
 *  account comes from the frame, not from the argument. */
export async function deleteSubscription(accountId: string, slug: string) {
  const db = getDb();
  await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.slug, slug), eq(subscriptions.accountId, accountId)));
}
