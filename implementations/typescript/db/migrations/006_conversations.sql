-- ---------------------------------------------------------------------------
-- Active form-fill conversations. One row per in-flight conversation
-- between a (bot, chat, user). Carries the field schedule, partial value,
-- and current cursor.
--
-- Routing: when a `telegram.message` event arrives, the runtime looks up
-- the active conversation by `(bot_id, chat_id, user_id, status='active')`
-- and advances it. On completion the row is marked `completed` and a
-- `telegram.form.completed` event fires for downstream triggers.
-- ---------------------------------------------------------------------------

CREATE TYPE conversation_status AS ENUM ('active', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id),
  bot_id                UUID NOT NULL REFERENCES bots(id),
  chat_id               BIGINT NOT NULL,
  user_id               BIGINT NOT NULL,
  form_id               TEXT NOT NULL,
  fields                JSONB NOT NULL,
  partial_value         JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_field_index   INTEGER NOT NULL DEFAULT 0,
  status                conversation_status NOT NULL DEFAULT 'active',
  completion_payload    JSONB DEFAULT '{}'::jsonb,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS conversations_bot_chat_user_idx
  ON conversations(bot_id, chat_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_active_idx
  ON conversations(bot_id, chat_id, user_id, status);
