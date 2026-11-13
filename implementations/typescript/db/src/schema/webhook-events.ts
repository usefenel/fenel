import { pgTable, primaryKey, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---------------------------------------------------------------------------
// Webhook idempotency table
//
// Each (provider, provider_event_id) row records a webhook we've already
// processed. INSERT ON CONFLICT DO NOTHING; handler checks the affected
// row count to decide whether to do work or just ack.
// ---------------------------------------------------------------------------

export const webhookEvents = pgTable(
  "webhook_events",
  {
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerEventId] }),
    index("webhook_events_account_recent_idx").on(
      table.accountId,
      table.processedAt,
    ),
  ],
);
