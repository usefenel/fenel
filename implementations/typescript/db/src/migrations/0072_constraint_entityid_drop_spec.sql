-- Phase 3.4c of typeclass-substrate-completion — complete the `Spec`-suffix
-- clean break in PERSISTED data: nested Constraint class refs of the typed-Id
-- form `{$tag:"Id", entityId:"<X>Spec"}` drop the `Spec` suffix on `entityId`
-- (e.g. `HasStateIOSpec` -> `HasStateIO`). This is the persisted-data companion
-- to the code-side rename of the 162 Constraint entityIds + the deletion of
-- every `.replace(/Spec$/)` suffix-strip bridge. Once the bridges are gone the
-- runtime no longer tolerates a `<X>Spec` entityId, so any production row that
-- still carries one must be rewritten here.
--
-- Pre-execution probe against staging (2026-05-29) returned ZERO rows across
-- all 8 JSONB carrier columns (types.type, functions.function,
-- function_instances.variables, typeclass_instances.instance, views.view,
-- locus_views.view, saved_queries.query, registries.module) — a loose probe
-- (any typed-Id row carrying any `Spec"`-ending string) confirmed zero. Prior
-- phases (0070 Shape 5, 0071) found the same. The migration is DEFENSIVE — it
-- must still ship so any production row gets correctly rewritten. Idempotent:
-- the walker only rewrites a `{$tag:"Id"}` node whose entityId ends in `Spec`,
-- and a re-run finds none.
--
-- Email collision: a Constraint that referenced the email *capability* class
-- was `EmailSpec`; the suffix-free form `Email` collides with the data entity
-- `Email`, so it maps to `EmailService` (mirroring 0071's corpus rename). All
-- other names are a clean "drop Spec". The substrate TYPE names
-- (`SpecInstance` / `SpecRecordSeed` / `SpecRecordMethod` / `SpecRecordLaw`)
-- never appear as a Constraint `entityId`, and none end in `Spec`, so they are
-- untouched.
--
-- Carrier shape handled:
--   nested Constraint class ref — typed-Id form `{$tag:"Id", entityId:"<X>Spec"}`
--   (post-0062). Walker modeled on 0070_lowercase_capability_rename.sql Shape 5.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.phase34c_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  ent_id text;
  new_id text;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.phase34c_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Post-order: recurse children first.
  result := (
    SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.phase34c_walk(x.v)), '{}'::jsonb)
    FROM jsonb_each(j) AS x(k, v)
  );

  -- Typed-Id Constraint class shape: `{$tag: "Id", entityId: "<X>Spec"}`.
  -- Drop the trailing `Spec`; `EmailSpec` -> `EmailService` (collision).
  IF result ? '$tag' AND (result ->> '$tag') = 'Id' AND result ? 'entityId' THEN
    ent_id := result ->> 'entityId';
    IF ent_id LIKE '%Spec' THEN
      IF ent_id = 'EmailSpec' THEN
        new_id := 'EmailService';
      ELSE
        new_id := substring(ent_id from 1 for length(ent_id) - 4);
      END IF;
      result := result || jsonb_build_object('entityId', new_id);
    END IF;
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply the walker to every JSONB column that carries Constraint refs. The
-- LIKE-filter narrows the row scan; the walker is idempotent so over-filtering
-- only costs scan time.

UPDATE types
SET type = pg_temp.phase34c_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"$tag":"Id"%';

UPDATE functions
SET function = pg_temp.phase34c_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"$tag":"Id"%';

UPDATE function_instances
SET variables = pg_temp.phase34c_walk(variables)
WHERE variables::text LIKE '%"$tag":"Id"%';

UPDATE typeclass_instances
SET instance = pg_temp.phase34c_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"$tag":"Id"%';

UPDATE views
SET view = pg_temp.phase34c_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$tag":"Id"%';

UPDATE locus_views
SET view = pg_temp.phase34c_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$tag":"Id"%';

UPDATE saved_queries
SET query = pg_temp.phase34c_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"$tag":"Id"%';

UPDATE registries
SET module = pg_temp.phase34c_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"$tag":"Id"%';

COMMIT;
