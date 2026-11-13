-- FM-retire-Z (2026-06-10) — RETIRE the `FieldDef.default` slot. The inverse of
-- `0058_field_default_to_maybe.sql`: where 0058 LIFTED `default` to a canonical
-- `Maybe<unknown>`, this DELETES the `default` key from every persisted FieldDef.
--
-- Rationale: a per-field `default` slot is an anti-pattern — "a default value of
-- a type" is the type-level `HasDefault` typeclass, not a per-field annotation.
-- The TS `FieldDef` type no longer carries `default`; readers resolve defaults
-- via `field-meta.ts:defaultValueFor` (HasDefault + structural recursion), and
-- the class-method-default channel (`field: T = expr`) rides the harvested
-- `FenelModule.methodDefaults` sidecar into `ClassMethod.body`.
--
-- Pre-verified at migration time: ZERO stored `default: {$tag:"Just",...}` rows
-- across functions/types/entity_instances (the slot was 100% `Nothing`
-- boilerplate in JSONB). So this loses no authored data — it strips dead keys.
-- Stored `default: {$tag:"Nothing"}` keys are already HARMLESS post-retirement
-- (TS readers ignore extra JSONB keys); this is decoupled cleanup, not a
-- correctness gate.
--
-- Detection: identical to 0058 — a JSONB object is a FieldDef carrier when it
-- has BOTH a `name` (string) key AND a sibling `type` key. Same false-positive
-- guard analysis (SelectOption / TypeView / CaseDef / Module skipped by absence
-- of `type:`; LambdaParam's harmless `default` strip is a no-op for its readers).
--
-- Idempotency: deleting an absent `default` key is a no-op, so re-running is safe.
--
-- Scope: the FieldDef-bearing JSONB columns from the 0058 set that STILL EXIST
-- (typeclass_instances dropped at 0077; form_definitions collapsed at 0073),
-- plus entity_instances.data.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.strip_field_default_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_fielddef boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.strip_field_default_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs strip too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.strip_field_default_walk(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef? Detection: has `name` (string) AND `type`.
  is_fielddef := jsonb_typeof(result) = 'object'
                 AND (result ? 'name')
                 AND jsonb_typeof(result -> 'name') = 'string'
                 AND (result ? 'type');

  IF is_fielddef THEN
    -- Strip the retired `default` slot (no-op when absent).
    result := result - 'default';
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

UPDATE types
SET type = pg_temp.strip_field_default_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"default"%';

UPDATE functions
SET function = pg_temp.strip_field_default_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"default"%';

UPDATE function_instances
SET variables = pg_temp.strip_field_default_walk(variables)
WHERE variables::text LIKE '%"default"%';

UPDATE views
SET view = pg_temp.strip_field_default_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"default"%';

UPDATE locus_views
SET view = pg_temp.strip_field_default_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"default"%';

UPDATE saved_queries
SET query = pg_temp.strip_field_default_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"default"%';

UPDATE registries
SET module = pg_temp.strip_field_default_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"default"%';

UPDATE entity_instances
SET data = pg_temp.strip_field_default_walk(data)
WHERE data::text LIKE '%"default"%';

COMMIT;
