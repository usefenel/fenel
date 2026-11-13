-- Subscription unification — PR-S-3 + start of PR-S-5.
--
-- Makes handler_function_id nullable so http_webhook subscriptions can omit
-- it when the dispatch is built-in (e.g. telegram_collector). Backfills
-- existing function_triggers and bots.webhook_secret rows into the
-- subscriptions table so the reader cutover doesn't lose any active
-- triggers / webhook bindings. Legacy tables stay around for the
-- deprecation window — no DROPs here.

ALTER TABLE subscriptions ALTER COLUMN handler_function_id DROP NOT NULL;

-- Drop the per-account uniqueness on slug; the unified webhook ingress
-- looks up subscriptions by slug across accounts (the secret in the
-- request header authenticates the call), so slug must be globally
-- unique.
DROP INDEX IF EXISTS subscriptions_account_slug_idx;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_slug_idx
  ON subscriptions (slug);

-- Backfill: function_triggers → subscriptions. One subscription per
-- active trigger row. Slug carries the trigger id so a later DELETE on
-- the trigger maps cleanly. Metadata mirrors the original trigger
-- record so processEvent can re-run triggerMatches without a table
-- join.
INSERT INTO subscriptions (
  account_id, slug, source, event_type, handler_function_id,
  enabled, metadata, created_at
)
SELECT
  ft.account_id,
  'evt-' || ft.id::text,
  'event'::subscription_source,
  ft.trigger->>'type',
  ft.function_id,
  ft.active,
  jsonb_build_object(
    'trigger',    ft.trigger,
    'cancelWhen', ft.cancel_when,
    'args',       ft.args,
    'legacyTriggerId', ft.id::text
  )::text,
  ft.created_at
FROM function_triggers ft
ON CONFLICT (slug) DO NOTHING;

-- Backfill: bots with a webhook_secret → http_webhook subscription.
-- handler_function_id is NULL — the unified ingress dispatches via
-- metadata.kind = 'telegram_collector' to the existing
-- telegram_collector.handle_update IO action.
INSERT INTO subscriptions (
  account_id, slug, source, secret, handler_function_id,
  enabled, metadata, created_at
)
SELECT
  b.account_id,
  'tg-bot-' || b.id::text,
  'http_webhook'::subscription_source,
  b.webhook_secret,
  NULL,
  b.enabled,
  jsonb_build_object(
    'kind',       'telegram_collector',
    'botId',      b.id::text,
    'webhookUrl', b.webhook_url
  )::text,
  b.created_at
FROM bots b
WHERE b.webhook_secret IS NOT NULL
ON CONFLICT (slug) DO NOTHING;
