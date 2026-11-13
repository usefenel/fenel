-- Migration: 0012_form_definitions_type_column
-- Phase 9.G.4 — adds a canonical `type` JSONB column on form_definitions
-- mirroring the 0010 migration on entity_definitions. The legacy `fields`
-- column (FormField[]) stays for now; consumers that go through the engine
-- helper `formDefinitionFields(def)` see both shapes transparently.
--
--   fields = [{ id, label, type, ui, meta, defaultValue }, ...]
--   ↓
--   type = { $record: { fields: [{ name, label, type, ui, meta, default }, ...] } }
--
-- Mirrors `fieldDefFromFormField` in packages/engine/src/field-meta.ts —
-- keep them in sync.
--
-- Idempotent: running it again is a no-op because the WHERE clause skips
-- rows that already have `type` set.

ALTER TABLE "form_definitions"
  ADD COLUMN IF NOT EXISTS "type" jsonb;
-->statement-breakpoint

UPDATE "form_definitions"
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
        FROM jsonb_array_elements("fields") AS f
      ),
      '[]'::jsonb
    )
  )
)
WHERE "type" IS NULL
  AND "fields" IS NOT NULL
  AND jsonb_typeof("fields") = 'array';
