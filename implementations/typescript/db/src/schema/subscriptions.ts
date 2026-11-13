// ---------------------------------------------------------------------------
// Subscriptions — unified webhook + trigger registry.
//
// One row binds an inbound source (HTTP webhook at /api/<slug>, an event
// type, a cron expression, or a named signal) to a Fenel function that
// runs when the source fires. Replaces the parallel registries:
//   - function_triggers (event-type → function id)
//   - bots.{webhookUrl, webhookSecret} (Telegram-specific webhook config)
//
// Migration sequence is documented in design/subscription-unification.md.
// This schema is PR-S-2 — table created, helper queries land alongside.
// Reads still come from the legacy tables; writers will dual-write in a
// follow-up commit before the cutover.
// ---------------------------------------------------------------------------

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const subscriptionSource = pgEnum("subscription_source", [
  "http_webhook",
  "event",
  "cron",
  "signal",
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** URL-segment slug. Unique per account. The webhook ingress
     *  resolves a `POST /api/<slug>` request via this. */
    slug: text("slug").notNull(),
    source: subscriptionSource("source").notNull(),
    /** For source = http_webhook — the secret echoed by the caller in
     *  a header that we verify before invoking the handler. NULL when
     *  the source isn't HTTP-based. */
    secret: text("secret"),
    /** For source = event — the event type pattern matched at
     *  processEvent. NULL otherwise. */
    eventType: text("event_type"),
    /** For source = cron — the schedule expression. NULL otherwise. */
    cronExpr: text("cron_expr"),
    /** Function id of the handler — references a row in `functions`.
     *  Nullable for built-in dispatch paths whose handler isn't a
     *  user-defined function (e.g. http_webhook subscriptions whose
     *  `metadata.kind` selects an IO action like
     *  `telegram_collector.handle_update`). */
    handlerFunctionId: uuid("handler_function_id"),
    /** Off switch — disabled rows don't dispatch. */
    enabled: boolean("enabled").notNull().default(true),
    /** Free-form JSON for additional source-specific config (filters,
     *  rate limits, future fields) — leaving this as jsonb avoids a
     *  schema migration for every new source kind. */
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("subscriptions_slug_idx").on(table.slug),
    accountSourceIdx: index("subscriptions_account_source_idx").on(
      table.accountId,
      table.source,
    ),
    eventTypeIdx: index("subscriptions_event_type_idx").on(
      table.accountId,
      table.eventType,
    ),
  }),
);
