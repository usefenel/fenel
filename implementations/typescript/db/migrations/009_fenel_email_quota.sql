-- ---------------------------------------------------------------------------
-- Per-account rate limit on the Fenel-managed default email sender
--
-- The Fenel-managed sender pool is shared infrastructure — one customer
-- blasting unlimited mail tarnishes deliverability for everyone else on
-- the same domain. We track per-account hourly send counts so the
-- runtime can refuse over-quota sends before they hit Mailgun.
--
-- Window: floor(epoch_ms / 3600_000) * 3600_000 — hourly buckets.
-- Atomic increment via INSERT ... ON CONFLICT ... DO UPDATE RETURNING.
--
-- Customers who configure their own provider (mailgun / postmark / ses /
-- resend) bypass this entirely — only the `fenel` pseudo-provider checks.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fenel_managed_email_quota (
  account_id    UUID NOT NULL REFERENCES accounts(id),
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, window_start)
);

-- Cleanup of old quota rows is a separate concern (a periodic job can
-- DELETE rows older than 30 days). The PK keeps the hot row count small
-- in the meantime — at most one row per account per hour.
