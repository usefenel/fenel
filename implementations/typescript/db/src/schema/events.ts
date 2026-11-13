import {
  pgTable,
  bigserial,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    type: text("type").notNull(),
    aggregateType: text("aggregate_type"),
    aggregateId: uuid("aggregate_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Intentionally NOT a FK — events are immutable, profiles can be merged/deleted
    profileId: uuid("profile_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_account_type_idx").on(table.accountId, table.type),
    index("events_account_profile_idx").on(table.accountId, table.profileId),
    index("events_account_aggregate_idx").on(
      table.accountId,
      table.aggregateType,
      table.aggregateId,
    ),
  ],
);
