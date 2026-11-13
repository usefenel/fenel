-- Migration: 0020_drop_form_definitions_fields
-- Phase 9.G.4 Step 4d — drops the legacy `fields` column on
-- form_definitions. Run AFTER 0018 has been applied and verified
-- (every row's `type` column matches the engine's lift of `fields`).
--
-- Irreversible: backups exist via scripts/backup-fields.ts JSONL.

ALTER TABLE "form_definitions" DROP COLUMN IF EXISTS "fields";
