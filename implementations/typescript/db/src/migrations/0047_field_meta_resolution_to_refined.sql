-- Phase 2 of field-meta-collapse — lift `meta.numberResolution` and
-- `meta.dateResolution` sidecar keys into the field's type as a
-- `$refined { base, set: $where … }` wrapper.
--
-- Background: the field-editor wrote two undeclared keys into `FieldDef.meta`
-- via string-cast — `numberResolution: [num, den]` (divisibility step) and
-- `dateResolution: DateResolution` (precision level). The validator confirms
-- (`validate.ts:299-301` / `:510-512` / `:521-524`) that the `$refined` set
-- wrapper is the canonical home; nothing reads the meta keys outside the
-- field-editor's own round-trip. Phase 2 retires them.
--
-- Lift rule (atomic-base case — the only one this migration commits to):
--
--   {                                          {
--     "type": {"$named": "Number"},              "type": {
--     "meta": {                       ⇒          "$refined": {
--       "numberResolution": [1, 100]                "base": {"$named": "Number"},
--     }                                            "set": {"$where": {"call": [
--   }                                                "isMultipleOf",
--                                                  {"var": "value"},
--                                                  1, 100
--                                                ]}}
--                                              }
--                                            },
--                                            meta key dropped (entire meta
--                                            removed if it becomes {})
--                                          }
--
-- When the type is already `$refined` over the same base, the resolution
-- `$where` composes via `$intersect [existing, where]` so the preset / user
-- constraint stays in force alongside the resolution refinement.
--
-- The legacy `{$maybe: <inner>}` shorthand is peeled and re-wrapped (the
-- inner type carries the refinement, not the Maybe outer). The canonical
-- Maybe encoding (`$variant {Nothing | Just}`) is structurally complex
-- and is NOT peeled by this migration — those rows keep their `meta` key
-- and the field-editor's read-path falls back to it (load-bearing safety
-- net during the migration window; the next save re-emits canonical form).
--
-- `meta.refGeoResolution` is OUT of scope — Phase 4 architectural work.
-- This migration explicitly leaves that key alone.
--
-- Idempotent: a second run on already-lifted rows is a no-op (the meta
-- keys are absent → the lift gate at `meta -> 'numberResolution'` /
-- `meta -> 'dateResolution'` returns NULL → return result unchanged).
--
-- Pattern: a recursive PL/pgSQL JSONB walker, mirroring the precedent of
-- `0040_operator_form_to_call.sql` / `0041_fold_to_preimage.sql` but
-- structural (not a substring REPLACE) because the lift moves a value
-- between siblings, not just renames a key.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_resolution(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  meta jsonb;
  type_val jsonb;
  num_res jsonb;
  date_res jsonb;
  was_maybe boolean;
  inner_type jsonb;
  base jsonb;
  existing_set jsonb;
  res_where jsonb;
  combined_set jsonb;
  new_inner jsonb;
  new_type jsonb;
  new_meta jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_resolution(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_resolution(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef carrying a retire-able resolution sidecar?
  meta := result -> 'meta';
  type_val := result -> 'type';
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN RETURN result; END IF;
  IF type_val IS NULL THEN RETURN result; END IF;

  num_res := meta -> 'numberResolution';
  date_res := meta -> 'dateResolution';
  IF num_res IS NULL AND date_res IS NULL THEN RETURN result; END IF;

  -- Peel legacy `$maybe` shorthand. Canonical $variant Maybe shapes are
  -- left alone (read-path falls back to meta key).
  was_maybe := false;
  inner_type := type_val;
  IF jsonb_typeof(inner_type) = 'object' AND (inner_type ? '$maybe') THEN
    was_maybe := true;
    inner_type := inner_type -> '$maybe';
  END IF;

  -- Peel $refined to capture existing set.
  base := inner_type;
  existing_set := NULL;
  IF jsonb_typeof(inner_type) = 'object' AND (inner_type ? '$refined') THEN
    base := inner_type -> '$refined' -> 'base';
    existing_set := inner_type -> '$refined' -> 'set';
  END IF;

  -- Only lift when the base is the expected atom (Number for numberResolution,
  -- Date for dateResolution). Otherwise leave the meta key alone — the read
  -- path's soft fallback handles the unusual case.
  IF NOT (jsonb_typeof(base) = 'object' AND (base ? '$named')) THEN
    RETURN result;
  END IF;

  res_where := NULL;
  IF num_res IS NOT NULL
     AND jsonb_typeof(num_res) = 'array'
     AND jsonb_array_length(num_res) = 2
     AND (base ->> '$named') = 'Number' THEN
    res_where := jsonb_build_object(
      '$where', jsonb_build_object(
        'call', jsonb_build_array(
          'isMultipleOf',
          jsonb_build_object('var', 'value'),
          num_res -> 0,
          num_res -> 1
        )
      )
    );
  ELSIF date_res IS NOT NULL
        AND jsonb_typeof(date_res) = 'string'
        AND (base ->> '$named') = 'Date' THEN
    res_where := jsonb_build_object(
      '$where', jsonb_build_object(
        'call', jsonb_build_array(
          'validateDateResolution',
          jsonb_build_object('var', 'value'),
          date_res
        )
      )
    );
  END IF;

  IF res_where IS NULL THEN RETURN result; END IF;

  -- Compose with existing set via $intersect; bare $where when no preset.
  combined_set := CASE
    WHEN existing_set IS NULL THEN res_where
    ELSE jsonb_build_object('$intersect', jsonb_build_array(existing_set, res_where))
  END;

  new_inner := jsonb_build_object(
    '$refined', jsonb_build_object('base', base, 'set', combined_set)
  );
  new_type := CASE
    WHEN was_maybe THEN jsonb_build_object('$maybe', new_inner)
    ELSE new_inner
  END;

  -- Strip resolution keys from meta; drop meta entirely if now empty.
  new_meta := (meta - 'numberResolution') - 'dateResolution';
  IF new_meta = '{}'::jsonb THEN
    result := (result || jsonb_build_object('type', new_type)) - 'meta';
  ELSE
    result := result || jsonb_build_object('type', new_type, 'meta', new_meta);
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-bearing
-- data. Column set mirrors the precedent set by 0040 / 0041, plus targets
-- updated in 0044 (dispatch_registry).

UPDATE types
SET type = pg_temp.lift_field_resolution(type),
    updated_at = NOW()
WHERE type::text LIKE '%"numberResolution"%'
   OR type::text LIKE '%"dateResolution"%';

UPDATE functions
SET function = pg_temp.lift_field_resolution(function),
    updated_at = NOW()
WHERE function::text LIKE '%"numberResolution"%'
   OR function::text LIKE '%"dateResolution"%';

UPDATE function_instances
SET variables = pg_temp.lift_field_resolution(variables)
WHERE variables::text LIKE '%"numberResolution"%'
   OR variables::text LIKE '%"dateResolution"%';

UPDATE dispatch_registry
SET instance = pg_temp.lift_field_resolution(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"numberResolution"%'
   OR instance::text LIKE '%"dateResolution"%';

UPDATE views
SET view = pg_temp.lift_field_resolution(view),
    updated_at = NOW()
WHERE view::text LIKE '%"numberResolution"%'
   OR view::text LIKE '%"dateResolution"%';

UPDATE locus_views
SET view = pg_temp.lift_field_resolution(view),
    updated_at = NOW()
WHERE view::text LIKE '%"numberResolution"%'
   OR view::text LIKE '%"dateResolution"%';

UPDATE saved_queries
SET query = pg_temp.lift_field_resolution(query),
    updated_at = NOW()
WHERE query::text LIKE '%"numberResolution"%'
   OR query::text LIKE '%"dateResolution"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_resolution(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_resolution(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"numberResolution"%'
   OR type::text LIKE '%"dateResolution"%'
   OR on_submit::text LIKE '%"numberResolution"%'
   OR on_submit::text LIKE '%"dateResolution"%';

UPDATE registries
SET module = pg_temp.lift_field_resolution(module),
    updated_at = NOW()
WHERE module::text LIKE '%"numberResolution"%'
   OR module::text LIKE '%"dateResolution"%';

COMMIT;
