-- Phase 5c of field-meta-collapse — promote `meta.multiple === true`
-- sidecar key into the field's type as `$list { elem: <type> }`.
-- First TYPE-SHAPE LIFT migration where the wrap is a flat one-level
-- wrap of the existing type rather than a structural reshape (0049
-- replaced an inner Id-shaped phantom with a Place-shaped phantom;
-- this just wraps).
--
-- Background: `meta.multiple` was a String-only special case that
-- duplicated universal `$list T` validation. The Fenel body's
-- `validateStringMultiCollect` helper walked array-of-strings
-- against a set, exactly what the universal `$list` branch does
-- for any element type. Phase 5c collapses the duplicate code path
-- by promoting the field's type.
--
-- Lift rule:
--
--   {                                            {
--     "type": <T>,                                 "type": {"$list": {"elem": <T>}},
--     "meta": {"multiple": true}                   meta key dropped (entire
--   }                                              meta removed if now empty)
--                                                }
--
-- Skip when `meta.multiple` is absent or non-true: no-op.
-- Skip when the field's `type` is already `$list T` (the writer is
-- already on the new shape but the migration also ran): defensive
-- idempotency — drop the key, leave the type.
--
-- Persisted VALUES are already arrays per the multi-select widget
-- contract (the SelectEditor / list-pipeline stored arrays even
-- when `meta.multiple===true` was the channel). No value migration
-- needed — only the type-shape changes.
--
-- Idempotent: a second run on already-migrated rows is a no-op (the
-- meta.multiple gate returns NULL → return result unchanged).
--
-- Pattern: recursive PL/pgSQL JSONB walker, mirroring 0049's shape
-- for type-mutation + 0051's 9-column structural sweep.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_multiple(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  meta jsonb;
  type_val jsonb;
  is_multiple boolean;
  new_type jsonb;
  new_meta jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_multiple(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_multiple(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef carrying meta.multiple === true?
  meta := result -> 'meta';
  type_val := result -> 'type';
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN RETURN result; END IF;
  IF type_val IS NULL THEN RETURN result; END IF;

  -- meta.multiple must be a JSON boolean true. Anything else (absent,
  -- false, null, string) is a no-op.
  is_multiple := (meta -> 'multiple') = 'true'::jsonb;
  IF NOT is_multiple THEN RETURN result; END IF;

  -- Defensive: if the type is already $list-shaped, just drop the key.
  IF jsonb_typeof(type_val) = 'object' AND (type_val ? '$list') THEN
    new_type := type_val;
  ELSE
    new_type := jsonb_build_object(
      '$list', jsonb_build_object('elem', type_val)
    );
  END IF;

  -- Strip multiple from meta; drop meta entirely if now empty.
  new_meta := meta - 'multiple';
  IF new_meta = '{}'::jsonb THEN
    result := (result || jsonb_build_object('type', new_type)) - 'meta';
  ELSE
    result := result || jsonb_build_object('type', new_type, 'meta', new_meta);
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-bearing
-- data. Column set mirrors the precedent set by 0047 / 0048 / 0049 /
-- 0050 / 0051, using `typeclass_instances.instance` (renamed from
-- `dispatch_registry` in an earlier migration).

UPDATE types
SET type = pg_temp.lift_field_multiple(type),
    updated_at = NOW()
WHERE type::text LIKE '%"multiple":true%';

UPDATE functions
SET function = pg_temp.lift_field_multiple(function),
    updated_at = NOW()
WHERE function::text LIKE '%"multiple":true%';

UPDATE function_instances
SET variables = pg_temp.lift_field_multiple(variables)
WHERE variables::text LIKE '%"multiple":true%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_multiple(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"multiple":true%';

UPDATE views
SET view = pg_temp.lift_field_multiple(view),
    updated_at = NOW()
WHERE view::text LIKE '%"multiple":true%';

UPDATE locus_views
SET view = pg_temp.lift_field_multiple(view),
    updated_at = NOW()
WHERE view::text LIKE '%"multiple":true%';

UPDATE saved_queries
SET query = pg_temp.lift_field_multiple(query),
    updated_at = NOW()
WHERE query::text LIKE '%"multiple":true%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_multiple(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_multiple(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"multiple":true%'
   OR on_submit::text LIKE '%"multiple":true%';

UPDATE registries
SET module = pg_temp.lift_field_multiple(module),
    updated_at = NOW()
WHERE module::text LIKE '%"multiple":true%';

COMMIT;
