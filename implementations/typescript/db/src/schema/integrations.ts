import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// ---------------------------------------------------------------------------
// Integration types — each maps to a specific external service
// ---------------------------------------------------------------------------

export const integrationType = pgEnum("integration_type", [
  "stripe",
  "nowpayments",
  "calendly",
  "telegram_bot",
  "webhook",
  "email_smtp",
  "twitter",
  "anthropic",
  "openai",
  "mailgun",
  "postmark",
  "ses",
  "resend",
]);

export const integrationStatus = pgEnum("integration_status", [
  "active",
  "failing",
  "expired",
  "disabled",
]);

// ---------------------------------------------------------------------------
// Integrations table — one row per connected service per account
// ---------------------------------------------------------------------------

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    type: integrationType("type").notNull(),
    /** Human label, e.g. "Production Stripe" or "Staging Webhook" */
    label: text("label"),
    /** Service-specific credentials — keys, tokens, secrets */
    credentials: jsonb("credentials")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Non-secret config — webhook URLs, modes, preferences */
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .default({}),
    status: integrationStatus("status").notNull().default("active"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One integration of each type per account (can lift if multi-Stripe needed)
    uniqueIndex("integrations_account_type_idx").on(
      table.accountId,
      table.type,
    ),
  ],
);
