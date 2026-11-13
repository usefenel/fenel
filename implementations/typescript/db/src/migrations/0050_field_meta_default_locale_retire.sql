-- Phase 5a of field-meta-collapse — retire `meta.defaultLocale` sidecar
-- key. Defensive sweep: production data is expected to carry ZERO rows
-- with this key (the Phase 5 pre-pass confirmed no production writers).
--
-- Background: `meta.defaultLocale` was vestigial TS plumbing. The
-- validator passed it to `dispatchedValidateLocaleString` as an
-- underscore-prefixed `_defaultLocale` param that was never read, and
-- the Fenel body (`fenel/modules/engine/validate.fenel:validateLocaleString`)
-- only ever accepted `schema rawValue path`. The original intent
-- (probably "coerce plain-string submissions into
-- `{<defaultLocale>: text}` server-side") was lost in the Phase 8a
-- Fenel-bodying refactor. The Phase 5 pre-pass classified the key as
-- DEAD CODE; this commit deletes the TS declaration + plumbing
-- (`field-meta.ts`, `validate.ts`, `engine-bodies-dispatch.ts`) and
-- sweeps any rogue persisted rows for hygiene.
--
-- Lift rule (simpler than 0047/0048/0049 — there is no destination
-- type-side encoding; the key was never load-bearing):
--
--   {                                            {
--     "type": <unchanged>,                         "type": <unchanged>,
--     "meta": {"defaultLocale": "en-US", …}  ⇒    "meta": {…}   (or meta key dropped
--                                                              entirely if now empty)
--   }                                            }
--
-- Idempotent: a second run on already-cleaned rows is a no-op (the
-- meta key is absent → the lift gate returns NULL → return result
-- unchanged).
--
-- Pattern: recursive PL/pgSQL JSONB walker, mirroring 0047 / 0048 /
-- 0049. The 9-column structural sweep is the same.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_default_locale(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  meta jsonb;
  new_meta jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_default_locale(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_default_locale(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef-shaped carrier of meta.defaultLocale?
  meta := result -> 'meta';
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN RETURN result; END IF;
  IF NOT (meta ? 'defaultLocale') THEN RETURN result; END IF;

  -- Strip defaultLocale from meta; drop meta entirely if now empty.
  new_meta := meta - 'defaultLocale';
  IF new_meta = '{}'::jsonb THEN
    result := result - 'meta';
  ELSE
    result := result || jsonb_build_object('meta', new_meta);
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-bearing
-- data. Column set mirrors the precedent set by 0047 / 0048 / 0049,
-- with one rename: `dispatch_registry.instance` → `typeclass_instances.instance`
-- (the table was renamed in an intervening commit; the column name +
-- semantics are unchanged).

UPDATE types
SET type = pg_temp.lift_field_default_locale(type),
    updated_at = NOW()
WHERE type::text LIKE '%"defaultLocale"%';

UPDATE functions
SET function = pg_temp.lift_field_default_locale(function),
    updated_at = NOW()
WHERE function::text LIKE '%"defaultLocale"%';

UPDATE function_instances
SET variables = pg_temp.lift_field_default_locale(variables)
WHERE variables::text LIKE '%"defaultLocale"%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_default_locale(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"defaultLocale"%';

UPDATE views
SET view = pg_temp.lift_field_default_locale(view),
    updated_at = NOW()
WHERE view::text LIKE '%"defaultLocale"%';

UPDATE locus_views
SET view = pg_temp.lift_field_default_locale(view),
    updated_at = NOW()
WHERE view::text LIKE '%"defaultLocale"%';

UPDATE saved_queries
SET query = pg_temp.lift_field_default_locale(query),
    updated_at = NOW()
WHERE query::text LIKE '%"defaultLocale"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_default_locale(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_default_locale(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"defaultLocale"%'
   OR on_submit::text LIKE '%"defaultLocale"%';

UPDATE registries
SET module = pg_temp.lift_field_default_locale(module),
    updated_at = NOW()
WHERE module::text LIKE '%"defaultLocale"%';

COMMIT;
