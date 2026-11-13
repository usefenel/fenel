-- Subscriptions: unified webhook + trigger registry.
--
-- See design/subscription-unification.md. This migration creates the
-- table; readers still come from function_triggers + bots.* in this
-- commit. The cutover lands in PR-S-3.

CREATE TYPE "subscription_source" AS ENUM (
  'http_webhook',
  'event',
  'cron',
  'signal'
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "slug" text NOT NULL,
  "source" "subscription_source" NOT NULL,
  "secret" text,
  "event_type" text,
  "cron_expr" text,
  "handler_function_id" uuid NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "metadata" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_account_slug_idx"
  ON "subscriptions" USING btree ("account_id", "slug");

CREATE INDEX IF NOT EXISTS "subscriptions_account_source_idx"
  ON "subscriptions" USING btree ("account_id", "source");

CREATE INDEX IF NOT EXISTS "subscriptions_event_type_idx"
  ON "subscriptions" USING btree ("account_id", "event_type");
