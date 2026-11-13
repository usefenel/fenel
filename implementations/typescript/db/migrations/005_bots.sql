-- ---------------------------------------------------------------------------
-- Per-account registered bots. One row per bot belonging to one account.
-- A single account can register many bots (marketing / support / paywalled-
-- channel-gating / agency-managed / etc.).
--
-- `id` is the Fenel-side stable identifier — flows through `fn:telegram:*`
-- IO handlers and trigger event payloads. `telegram_bot_id` is the
-- platform-side numeric id (the part before `:` in the token); kept
-- separately because it's the public identity, useful for matching
-- incoming updates.
--
-- `webhook_secret` is the value sent in `X-Telegram-Bot-Api-Secret-Token`
-- on inbound webhook posts. Generated locally when configuring the
-- webhook; verified on every POST.
-- ---------------------------------------------------------------------------

CREATE TYPE bot_platform AS ENUM ('telegram');

CREATE TABLE IF NOT EXISTS bots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  platform        bot_platform NOT NULL DEFAULT 'telegram',
  label           TEXT,
  username        TEXT,
  token           TEXT NOT NULL,
  telegram_bot_id BIGINT,
  webhook_secret  TEXT,
  webhook_url     TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bots_account_idx ON bots(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS bots_id_idx ON bots(id);
CREATE UNIQUE INDEX IF NOT EXISTS bots_account_telegram_bot_id_idx ON bots(account_id, telegram_bot_id);
