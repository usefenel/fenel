import { webhookEvents } from "../schema/webhook-events";
import { getDb } from "../client";

/**
 * Try to claim a (provider, provider_event_id) pair as "processed".
 *
 * Returns `true` when this is the first time we've seen this id (the
 * caller should proceed with whatever work the webhook requires) and
 * `false` when the row already existed (the caller should ack and exit
 * without re-processing).
 *
 * Uses Postgres ON CONFLICT DO NOTHING + RETURNING for an atomic
 * check-and-claim. No race window between check and insert.
 */
export async function markWebhookProcessed(
  provider: string,
  providerEventId: string,
  accountId: string,
): Promise<boolean> {
  const db = getDb();
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, providerEventId, accountId })
    .onConflictDoNothing({
      target: [webhookEvents.provider, webhookEvents.providerEventId],
    })
    .returning({ provider: webhookEvents.provider });
  return inserted.length > 0;
}
