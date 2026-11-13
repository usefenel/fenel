-- Telegram collector: bot-level collector config + per-conversation hooks.

ALTER TABLE "bots" ADD COLUMN "collector_config" jsonb;

ALTER TABLE "conversations" ADD COLUMN "hooks" jsonb;

-- Add "confirming" status for the confirmation step before completion.
ALTER TYPE "conversation_status" ADD VALUE IF NOT EXISTS 'confirming' AFTER 'active';
