-- Drop the dedicated `bots` table.
--
-- Bots are now persisted as `entity_instances` rows (entity_type = 'bot'),
-- matching the Fenel `bot` system entity declared in
-- `packages/engine/src/system-entities.ts`. Going through the generic
-- entity store keeps "everything is a typed Fenel value" — no special
-- table per entity kind. The bot's identity (label/description/icon/emoji)
-- now lives in `typeclass_instances` keyed by the bot's id, mirroring
-- the pattern used for types and functions.
--
-- The `conversations.bot_id` FK previously pointed at `bots.id`; we
-- repoint it at `entity_instances.id` since bots now live there.
-- Existing rows are dropped along with the table — dev environment
-- only, bots and conversations are easily re-registered.
--
-- Idempotent.

-- Wipe conversation rows that referenced the now-dropped bots (dev-only;
-- conversations re-create when bots redeploy).
DELETE FROM "conversations";

-- Drop the FK from conversations to the legacy bots table.
ALTER TABLE "conversations"
  DROP CONSTRAINT IF EXISTS "conversations_bot_id_bots_id_fk";

-- Remove the bots table + enum.
DROP TABLE IF EXISTS "bots";
DROP TYPE IF EXISTS "bot_platform";

-- Repoint the conversations.bot_id FK at entity_instances.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_bot_id_entity_instances_id_fk"
  FOREIGN KEY ("bot_id") REFERENCES "entity_instances"("id");
