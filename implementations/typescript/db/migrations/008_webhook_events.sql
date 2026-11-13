-- ---------------------------------------------------------------------------
-- Webhook idempotency table
--
-- Providers retry webhooks on 5xx (and sometimes on timeout / proxy hiccups).
-- Without dedup, retries double-emit `email.delivered` / `email.bounced`
-- events into the engine, which fires triggers twice.
--
-- Each provider stamps a unique identifier on every webhook payload:
--   - Mailgun: signature.token  (also used for HMAC; cryptographically unique)
--   - Postmark: MessageID + RecordType
--   - SES (via SNS): MessageId
--   - Resend: per-event id
--
-- We INSERT (provider, provider_event_id) on every webhook hit. The PK
-- gives ON CONFLICT DO NOTHING semantics — the second arrival is a no-op.
-- The handler checks the affected-row count to decide whether to process.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
  provider           TEXT NOT NULL,
  provider_event_id  TEXT NOT NULL,
  account_id         UUID NOT NULL REFERENCES accounts(id),
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, provider_event_id)
);

-- Optional index for "what events did we process for this account recently"
-- audit queries — small but cheap to maintain.
CREATE INDEX IF NOT EXISTS webhook_events_account_recent_idx
  ON webhook_events (account_id, processed_at DESC);
