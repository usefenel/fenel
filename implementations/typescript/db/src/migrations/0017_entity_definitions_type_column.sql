-- Migration: 0010_entity_definitions_type_column
-- Phase 9.H — adds a canonical `type` JSONB column on entity_definitions
-- that holds the FenelType ($record) shape, alongside the legacy `schema`
-- column (FormField[]). Existing rows are backfilled by lifting each
-- FormField into a FieldDef:
--
--   schema = [{ id, label, type, ui, meta, defaultValue }, ...]
--   ↓
--   type = { $record: { fields: [{ name, label, type, ui, meta, default }, ...] } }
--
-- Notes:
--   * Additive only. The legacy `schema` column stays for now so old
--     consumers and the dual-write API path keep working. A follow-up
--     migration drops `schema` once Step 4 of 9.H lands and consumers
--     stop reading it.
--   * The conversion mirrors `fieldDefFromFormField` in
--     packages/engine/src/field-meta.ts. Keep them in sync if either
--     side evolves.
--   * `jsonb_strip_nulls` removes optional FieldDef keys that were absent
--     on the source FormField (so a stored type stays clean).
--   * Idempotent: running it again is a no-op because the WHERE clause
--     skips rows that already have `type` set.

ALTER TABLE "entity_definitions"
  ADD COLUMN IF NOT EXISTS "type" jsonb;
-->statement-breakpoint

UPDATE "entity_definitions"
SET "type" = jsonb_build_object(
  '$record', jsonb_build_object(
    'fields', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'name',    f->>'id',
              'label',   f->'label',
              'type',    f->'type',
              'ui',      f->'ui',
              'meta',    f->'meta',
              'default', f->'defaultValue'
            )
          )
        )
        FROM jsonb_array_elements("schema"::jsonb) AS f
      ),
      '[]'::jsonb
    )
  )
)
WHERE "type" IS NULL
  AND "schema" IS NOT NULL
  AND json_typeof("schema") = 'array';
