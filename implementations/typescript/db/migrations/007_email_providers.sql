-- ---------------------------------------------------------------------------
-- Email-provider integration types: mailgun, postmark, ses
--
-- Adds three new values to the integration_type enum so accounts can
-- store credentials for each. Runtime provider handlers in
-- packages/runtime/src/providers.ts read these via getCredentials().
--
-- ALTER TYPE ... ADD VALUE must run outside a transaction; each line
-- below is its own statement. IF NOT EXISTS makes the migration
-- idempotent for replays.
-- ---------------------------------------------------------------------------

ALTER TYPE integration_type ADD VALUE IF NOT EXISTS 'mailgun';
ALTER TYPE integration_type ADD VALUE IF NOT EXISTS 'postmark';
ALTER TYPE integration_type ADD VALUE IF NOT EXISTS 'ses';
ALTER TYPE integration_type ADD VALUE IF NOT EXISTS 'resend';
