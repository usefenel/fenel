import { eq, and, desc, gt } from "drizzle-orm";
import { events } from "./schema/events";
import { getDb } from "./client";

export type EventInput = {
  accountId: string;
  type: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
  profileId?: string;
};

export async function appendEvent(input: EventInput) {
  const db = getDb();
  const [event] = await db
    .insert(events)
    .values({
      accountId: input.accountId,
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload ?? {},
      profileId: input.profileId,
    })
    .returning();

  return event!;
}

export async function queryEvents(opts: {
  accountId: string;
  type?: string;
  profileId?: string;
  aggregateType?: string;
  aggregateId?: string;
  afterId?: number;
  limit?: number;
}) {
  const db = getDb();
  const conditions = [eq(events.accountId, opts.accountId)];

  if (opts.type) conditions.push(eq(events.type, opts.type));
  if (opts.profileId) conditions.push(eq(events.profileId, opts.profileId));
  if (opts.aggregateType)
    conditions.push(eq(events.aggregateType, opts.aggregateType));
  if (opts.aggregateId)
    conditions.push(eq(events.aggregateId, opts.aggregateId));
  if (opts.afterId) conditions.push(gt(events.id, opts.afterId));

  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.id))
    .limit(opts.limit ?? 100);
}
