import { pgTable, primaryKey, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---------------------------------------------------------------------------
// Per-account hourly quota for the Fenel-managed default email sender.
// One row per (account, window_start) — count incremented atomically on
// each send.
// ---------------------------------------------------------------------------

export const fenelManagedEmailQuota = pgTable(
  "fenel_managed_email_quota",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.windowStart] })],
);
