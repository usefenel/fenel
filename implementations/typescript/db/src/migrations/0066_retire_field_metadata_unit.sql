-- Phase 11 of canonical-maybe — retire the deprecated
-- `FieldMetadata.unit?: UnitExpr` slot. The TS declaration at
-- `implementations/typescript/engine/src/field-meta.ts` collapses
-- from `{ unit?: UnitExpr }` to `Record<string, never>` — strictly
-- empty. Units have lived on the type itself since field-meta-
-- collapse Phase 3 (migration `0048`, 2026-05-26) via the
-- `Q : UnitExpr -> Type` constructor (`units.ts:Q`); this migration
-- is the defensive structural cleanup that matches the type-shape
-- retire.
--
-- Why a defensive sweep is cheap: `0048` already retired the runtime
-- writers + readers, but any post-`0048` re-injection from a stale
-- caller would land in JSONB columns without a structural typecheck
-- to catch it. Phase 11 collapses the TS type to `Record<string,
-- never>` — accidental future re-injection becomes a compile-time
-- error at the TS layer, but pre-existing rows still need a clean.
-- This walker handles them.
--
-- Detection: any FieldMetadata-shaped object identified by being a
-- value of a `meta:` key on a FieldDef-shape parent. FieldDef
-- detection rule = `name:`+`type:` co-presence (same as 0056 / 0057
-- / 0058 / 0065).
--
-- Action: delete the `unit` subkey if present; preserve every other
-- subkey verbatim (no assumption of empty-meta — any pre-existing
-- non-unit residue stays put for a separate cleanup if it surfaces).
--
-- Idempotent: if `unit` absent, no-op. If `meta` slot absent
-- altogether, no-op (the parent isn't lifted; Phase 9's `0065`
-- already lifted absent → `{}`).
--
-- Scope: same 9-column sweep as `0065` / `0058` / `0057` / `0056` /
-- `0055` / `0054`.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.retire_field_metadata_unit_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_fielddef boolean;
  meta_val jsonb;
  cleaned_meta jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.retire_field_metadata_unit_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDef
  -- meta-objects get cleaned too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.retire_field_metadata_unit_walk(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef? Detection: has `name` (string) AND
  -- has `type` (anything). Same rule as 0056 / 0057 / 0058 / 0065.
  is_fielddef := jsonb_typeof(result) = 'object'
                 AND (result ? 'name')
                 AND jsonb_typeof(result -> 'name') = 'string'
                 AND (result ? 'type');

  IF is_fielddef AND (result ? 'meta') THEN
    meta_val := result -> 'meta';
    IF jsonb_typeof(meta_val) = 'object' AND (meta_val ? 'unit') THEN
      -- Drop `unit` subkey; preserve every other subkey verbatim.
      cleaned_meta := meta_val - 'unit';
      result := jsonb_set(result, '{meta}', cleaned_meta);
    END IF;
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that carries FieldDef-bearing data.
-- Column set mirrors the precedent set by 0065 / 0058 / 0057 / 0056
-- / 0055 / 0054.

UPDATE types
SET type = pg_temp.retire_field_metadata_unit_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"unit":%';

UPDATE functions
SET function = pg_temp.retire_field_metadata_unit_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"unit":%';

UPDATE function_instances
SET variables = pg_temp.retire_field_metadata_unit_walk(variables)
WHERE variables::text LIKE '%"unit":%';

UPDATE typeclass_instances
SET instance = pg_temp.retire_field_metadata_unit_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"unit":%';

UPDATE views
SET view = pg_temp.retire_field_metadata_unit_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"unit":%';

UPDATE locus_views
SET view = pg_temp.retire_field_metadata_unit_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"unit":%';

UPDATE saved_queries
SET query = pg_temp.retire_field_metadata_unit_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"unit":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.retire_field_metadata_unit_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.retire_field_metadata_unit_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"unit":%'
   OR on_submit::text LIKE '%"unit":%';

UPDATE registries
SET module = pg_temp.retire_field_metadata_unit_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"unit":%';

COMMIT;
