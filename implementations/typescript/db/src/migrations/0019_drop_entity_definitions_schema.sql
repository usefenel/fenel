-- Migration: 0019_drop_entity_definitions_schema
-- Phase 9.H Step 4d — drops the legacy `schema` column on
-- entity_definitions. Run AFTER 0017 has been applied and verified
-- (every row's `type` column matches the engine's lift of `schema`).
--
-- Irreversible: backups exist via scripts/backup-fields.ts JSONL.
--
-- Once this lands, the engine's `entitySchemaFields(spec)` falls back
-- exclusively to `spec.type.$record`; the legacy `schema` parameter is
-- only there for stale row payloads in transit.

ALTER TABLE "entity_definitions" DROP COLUMN IF EXISTS "schema";
