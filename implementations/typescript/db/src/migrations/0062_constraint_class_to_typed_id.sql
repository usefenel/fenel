-- Phase 10a-5c — Constraint typed-Id migration.
--
-- After Phase 10a-5c the in-memory Constraint shape is
--   { class: { $tag: "Id", entityId: "<X>Spec" }, args: [...] }
-- where the previous shape was
--   { class: "<X>", args: [...] }
-- The entityId carries the spec record entity codename (`<X>Spec`); the
-- legacy class name (no `Spec` suffix) flows through the back-compat path
-- in `resolveConstraintClass` so persisted rows that haven't been
-- migrated still resolve. This migration converts them to the canonical
-- typed-Id form so the legacy fallback can retire in 10a-5d.
--
-- Detection rule: walk under `requires` / `supers` / `constraints` array
-- contexts; within those arrays, rewrite each element's `class` field
-- when it's still a raw string. Idempotent — skip when `class.$tag` is
-- already `"Id"`.
--
-- Two key-paths historically carry Constraint data in persisted JSONB:
--
--   functions.function.requires   — FenelFunction.requires per user-defined
--                                   function loaded from .fenel
--   typeclass_instances.instance.requires
--                                  — Phase 10a-2 added per-instance requires
--
-- The walker is structurally generic — any Constraint nested under
-- `requires`/`supers`/`constraints` in any column gets the same rewrite.
-- The 9-column sweep matches the canonical-maybe migration pattern
-- (0054..0061).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_p10a5c_walk(j jsonb, parent_key text)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  cls_val jsonb;
  is_constraint_ctx boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse over elements; propagate parent_key so elements of
  -- a `requires:`/`supers:`/`constraints:` array see their Constraint
  -- context.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_p10a5c_walk(elem, parent_key)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Recurse into all values first (post-order rewrite), passing each
  -- key as the parent context for its children. Array values pass
  -- THIS key as parent_key so elements inside arrays see the array
  -- name (e.g. `requires` for `requires: [...]`).
  result := (
    SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_p10a5c_walk(x.v, x.k)), '{}'::jsonb)
    FROM jsonb_each(j) AS x(k, v)
  );

  -- Constraint-shape rewrite: this object sits inside a
  -- `requires`/`supers`/`constraints` array, carries a string `class`
  -- field, and isn't already in typed-Id form.
  is_constraint_ctx := parent_key IN ('requires', 'supers', 'constraints');
  IF is_constraint_ctx
     AND (result ? 'class')
     AND (result ? 'args')
  THEN
    cls_val := result -> 'class';
    IF jsonb_typeof(cls_val) = 'string' THEN
      result := result || jsonb_build_object(
        'class',
        jsonb_build_object(
          '$tag', 'Id',
          'entityId', (cls_val #>> '{}') || 'Spec'
        )
      );
    END IF;
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column. Match-clause uses LIKE-filter on the
-- canonical Constraint-array keys to filter the row-scan; the walker is
-- idempotent so over-filtering only costs scan time.

UPDATE types
SET type = pg_temp.lift_p10a5c_walk(type, NULL),
    updated_at = NOW()
WHERE type::text LIKE '%"requires"%'
   OR type::text LIKE '%"supers"%'
   OR type::text LIKE '%"constraints"%';

UPDATE functions
SET function = pg_temp.lift_p10a5c_walk(function, NULL),
    updated_at = NOW()
WHERE function::text LIKE '%"requires"%'
   OR function::text LIKE '%"supers"%'
   OR function::text LIKE '%"constraints"%';

UPDATE function_instances
SET variables = pg_temp.lift_p10a5c_walk(variables, NULL)
WHERE variables::text LIKE '%"requires"%'
   OR variables::text LIKE '%"supers"%'
   OR variables::text LIKE '%"constraints"%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_p10a5c_walk(instance, NULL),
    updated_at = NOW()
WHERE instance::text LIKE '%"requires"%'
   OR instance::text LIKE '%"supers"%'
   OR instance::text LIKE '%"constraints"%';

UPDATE views
SET view = pg_temp.lift_p10a5c_walk(view, NULL),
    updated_at = NOW()
WHERE view::text LIKE '%"requires"%'
   OR view::text LIKE '%"supers"%'
   OR view::text LIKE '%"constraints"%';

UPDATE locus_views
SET view = pg_temp.lift_p10a5c_walk(view, NULL),
    updated_at = NOW()
WHERE view::text LIKE '%"requires"%'
   OR view::text LIKE '%"supers"%'
   OR view::text LIKE '%"constraints"%';

UPDATE saved_queries
SET query = pg_temp.lift_p10a5c_walk(query, NULL),
    updated_at = NOW()
WHERE query::text LIKE '%"requires"%'
   OR query::text LIKE '%"supers"%'
   OR query::text LIKE '%"constraints"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_p10a5c_walk(type, NULL) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_p10a5c_walk(on_submit, NULL) ELSE on_submit END
WHERE type::text LIKE '%"requires"%'
   OR type::text LIKE '%"supers"%'
   OR type::text LIKE '%"constraints"%'
   OR on_submit::text LIKE '%"requires"%'
   OR on_submit::text LIKE '%"supers"%'
   OR on_submit::text LIKE '%"constraints"%';

UPDATE registries
SET module = pg_temp.lift_p10a5c_walk(module, NULL),
    updated_at = NOW()
WHERE module::text LIKE '%"requires"%'
   OR module::text LIKE '%"supers"%'
   OR module::text LIKE '%"constraints"%';

COMMIT;
