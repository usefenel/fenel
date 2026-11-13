import { sql } from "drizzle-orm";
import { fenelManagedEmailQuota } from "../schema/fenel-email-quota";
import { getDb } from "../client";

/**
 * Atomically increment the Fenel-managed email send counter for an
 * account in the current hourly window. Returns the post-increment
 * count so the caller can compare against a quota limit.
 *
 * Uses Postgres `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` —
 * single round trip, no race window between read and increment.
 */
export async function incrementFenelEmailCount(
  accountId: string,
  now: Date = new Date(),
): Promise<number> {
  // Floor to the hour. Postgres can floor too (`date_trunc('hour', ...)`);
  // doing it in JS keeps the call site self-contained and side-step
  // any timezone weirdness.
  const ms = now.getTime();
  const windowStart = new Date(Math.floor(ms / 3_600_000) * 3_600_000);

  const db = getDb();
  const [row] = await db
    .insert(fenelManagedEmailQuota)
    .values({ accountId, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [fenelManagedEmailQuota.accountId, fenelManagedEmailQuota.windowStart],
      set: { count: sql`${fenelManagedEmailQuota.count} + 1` },
    })
    .returning({ count: fenelManagedEmailQuota.count });
  return row?.count ?? 0;
}
