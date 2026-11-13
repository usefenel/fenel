-- Phase 3 of field-meta-collapse — lift `meta.unit` sidecar key into the
-- field's type as a `Q : UnitExpr -> Type` $tagged-phantom wrapper.
--
-- Background: `meta.unit` (declared on `FieldMetadata` at field-meta.ts:25-28)
-- carried physical/dimensional units as a pure presentation hint. The
-- documented eventual home was a `Unitful` typeclass, but post-Phase-22
-- substrate maturation, dependent typing via `$tagged.phantom` is the
-- cleaner answer: `Q "USD" Number ≢ Q "EUR" Number` at the type level,
-- not just at runtime. Phase 3 retires the sidecar.
--
-- Lift rule (atomic-base case — the only one this migration commits to):
--
--   {                                                {
--     "type": {"$named": "Number"},                    "type": {
--     "meta": {                                ⇒        "$tagged": {
--       "unit": {                                          "value": {"$named": "Number"},
--         "dimension": "currency",                         "phantom": {
--         "code": "USD"                                      "$refined": {
--       }                                                      "base": {"$named": "UnitExpr"},
--     }                                                        "set": {"$enum": ["USD"]}
--   }                                                        }}}},
--                                                    meta key dropped (entire meta
--                                                    removed if it becomes {})
--                                                  }
--
-- Editor-shape → UnitExpr lift recipe: prefer `unit.code` (actual unit
-- semantics) over `unit.dimension` (editor-UX-only — filters the
-- dimension dropdown). When `unit` is a plain string, pass it through.
-- Algebraic UnitExpr trees (`$mul` / `$div` / `$pow` / `$one`) pass
-- through unchanged.
--
-- When the type is already `$refined` over `Number`, the Q wrap goes
-- INSIDE: `$refined { base: Q(unit), set }` — Q is the deeper structural
-- commitment; $refined wraps the unit-tagged Number with additional
-- predicates.
--
-- The legacy `{$maybe: <inner>}` shorthand is peeled and re-wrapped (the
-- inner type carries the Q wrap, not the Maybe outer). The canonical
-- Maybe encoding (`$variant {Nothing | Just}`) is NOT peeled by this
-- migration — those rows keep their `meta` key and the field-editor's
-- read-path falls back to it (load-bearing safety net during the
-- migration window; the next save re-emits canonical form).
--
-- Skip non-Number bases: `meta.unit` was sometimes attached to non-Number
-- fields by mistake — only lift when the base type peel resolves to
-- `{$named: "Number"}`. Leave others alone; read-path fallback catches.
--
-- Idempotent: a second run on already-lifted rows is a no-op (the meta
-- key is absent → the lift gate at `meta -> 'unit'` returns NULL →
-- return result unchanged).
--
-- Pattern: a recursive PL/pgSQL JSONB walker, mirroring the precedent of
-- `0047_field_meta_resolution_to_refined.sql`.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_unit(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  meta jsonb;
  type_val jsonb;
  unit_raw jsonb;
  unit_expr jsonb;
  unit_code jsonb;
  unit_dim jsonb;
  was_maybe boolean;
  inner_type jsonb;
  base jsonb;
  existing_set jsonb;
  q_wrap jsonb;
  new_inner jsonb;
  new_type jsonb;
  new_meta jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_unit(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_unit(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef carrying meta.unit?
  meta := result -> 'meta';
  type_val := result -> 'type';
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN RETURN result; END IF;
  IF type_val IS NULL THEN RETURN result; END IF;

  unit_raw := meta -> 'unit';
  IF unit_raw IS NULL THEN RETURN result; END IF;

  -- Lift unit_raw to a canonical UnitExpr.
  --   - string atom → passthrough
  --   - object with $mul/$div/$pow/$one → algebraic, passthrough
  --   - object with code → use code
  --   - object with dimension only → use dimension
  unit_expr := NULL;
  IF jsonb_typeof(unit_raw) = 'string' THEN
    unit_expr := unit_raw;
  ELSIF jsonb_typeof(unit_raw) = 'object' THEN
    IF (unit_raw ? '$mul') OR (unit_raw ? '$div') OR (unit_raw ? '$pow') OR (unit_raw ? '$one') THEN
      unit_expr := unit_raw;
    ELSE
      unit_code := unit_raw -> 'code';
      unit_dim := unit_raw -> 'dimension';
      IF unit_code IS NOT NULL AND jsonb_typeof(unit_code) = 'string' THEN
        unit_expr := unit_code;
      ELSIF unit_dim IS NOT NULL AND jsonb_typeof(unit_dim) = 'string' THEN
        unit_expr := unit_dim;
      END IF;
    END IF;
  END IF;

  IF unit_expr IS NULL THEN RETURN result; END IF;

  -- Peel legacy `$maybe` shorthand. Canonical $variant Maybe shapes left
  -- alone (read-path fallback handles them).
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

  -- Only lift when the base is Number.
  IF NOT (jsonb_typeof(base) = 'object' AND (base ? '$named') AND (base ->> '$named') = 'Number') THEN
    RETURN result;
  END IF;

  -- Build the Q wrap.
  q_wrap := jsonb_build_object(
    '$tagged', jsonb_build_object(
      'value', jsonb_build_object('$named', 'Number'),
      'phantom', jsonb_build_object(
        '$refined', jsonb_build_object(
          'base', jsonb_build_object('$named', 'UnitExpr'),
          'set', jsonb_build_object('$enum', jsonb_build_array(unit_expr))
        )
      )
    )
  );

  -- Place Q INSIDE the $refined wrapper when one exists; bare Q otherwise.
  new_inner := CASE
    WHEN existing_set IS NULL THEN q_wrap
    ELSE jsonb_build_object(
      '$refined', jsonb_build_object('base', q_wrap, 'set', existing_set)
    )
  END;
  new_type := CASE
    WHEN was_maybe THEN jsonb_build_object('$maybe', new_inner)
    ELSE new_inner
  END;

  -- Strip unit from meta; drop meta entirely if now empty.
  new_meta := meta - 'unit';
  IF new_meta = '{}'::jsonb THEN
    result := (result || jsonb_build_object('type', new_type)) - 'meta';
  ELSE
    result := result || jsonb_build_object('type', new_type, 'meta', new_meta);
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-bearing
-- data. Column set mirrors the precedent set by 0047.

UPDATE types
SET type = pg_temp.lift_field_unit(type),
    updated_at = NOW()
WHERE type::text LIKE '%"unit"%';

UPDATE functions
SET function = pg_temp.lift_field_unit(function),
    updated_at = NOW()
WHERE function::text LIKE '%"unit"%';

UPDATE function_instances
SET variables = pg_temp.lift_field_unit(variables)
WHERE variables::text LIKE '%"unit"%';

UPDATE dispatch_registry
SET instance = pg_temp.lift_field_unit(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"unit"%';

UPDATE views
SET view = pg_temp.lift_field_unit(view),
    updated_at = NOW()
WHERE view::text LIKE '%"unit"%';

UPDATE locus_views
SET view = pg_temp.lift_field_unit(view),
    updated_at = NOW()
WHERE view::text LIKE '%"unit"%';

UPDATE saved_queries
SET query = pg_temp.lift_field_unit(query),
    updated_at = NOW()
WHERE query::text LIKE '%"unit"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_unit(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_unit(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"unit"%'
   OR on_submit::text LIKE '%"unit"%';

UPDATE registries
SET module = pg_temp.lift_field_unit(module),
    updated_at = NOW()
WHERE module::text LIKE '%"unit"%';

COMMIT;
