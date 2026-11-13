-- Phase 10a-6 of canonical-maybe — positional constructor binding.
--
-- After Phase 10a-6, positional construction of std-lib parametric ADTs
-- binds by ORDER, not by declared field name. `Just x` / `Err e` / `Ok a`
-- / `Left a` / `Right b` all emit `{$tag: <Ctor>, _0: <value>}` regardless
-- of the constructor's declared field name.
--
-- Previously these emitted `{$tag: "Just", value: <X>}` because the
-- `construct` op looked up the constructor's declared field name (`value`
-- per `foundation.fenel`'s `Just value: a`). Phase 10a-6 strips the named
-- `value:` prefix from `foundation.fenel`, declares fields positionally
-- (auto-named `_0`), and the construct op uniformly emits `_N` for any
-- positional construction.
--
-- This migration walks every JSONB column historically carrying persisted
-- values and rewrites every `{$tag: <one-of>, value: X}` to `{$tag: <same>,
-- _0: X}` for the canonical positional-binding ctor set:
--
--   Just / Err / Ok / Left / Right
--
-- Other constructors with `value` as a declared field name (e.g.
-- `Unique value: a` in `LookupResult`, `Markup.Text value: String`) keep
-- their named field — they're not in the positional-binding ctor set, and
-- their stored shape matches their declaration.
--
-- Idempotent: skip when `_0` already present alongside `$tag`.
--
-- Phase 10a-6 closure: `Just x` / `Err e` / etc. work universally across
-- construct + pattern + read. `Just { _0 = x }` parses as the named-record
-- form per the universal named-args convention; legacy `Just { value = x }`
-- is no longer authored.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_p10a6_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  tag jsonb;
  inner_val jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse over elements.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_p10a6_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Recurse into all values first (post-order rewrite).
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_p10a6_walk(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Detect canonical positional-binding ctor with legacy `value` payload.
  tag := result -> '$tag';
  IF tag IN ('"Just"'::jsonb, '"Err"'::jsonb, '"Ok"'::jsonb, '"Left"'::jsonb, '"Right"'::jsonb)
     AND (result ? 'value')
     AND NOT (result ? '_0')
  THEN
    inner_val := result -> 'value';
    result := (result - 'value') || jsonb_build_object('_0', inner_val);
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column. Match-clause uses ANY of the canonical
-- positional ctor tags to filter the row-scan; the walker is idempotent
-- so over-filtering only costs scan time, not correctness.

UPDATE types
SET type = pg_temp.lift_p10a6_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"$tag": "Just"%'
   OR type::text LIKE '%"$tag": "Err"%'
   OR type::text LIKE '%"$tag": "Ok"%'
   OR type::text LIKE '%"$tag": "Left"%'
   OR type::text LIKE '%"$tag": "Right"%';

UPDATE functions
SET function = pg_temp.lift_p10a6_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"$tag": "Just"%'
   OR function::text LIKE '%"$tag": "Err"%'
   OR function::text LIKE '%"$tag": "Ok"%'
   OR function::text LIKE '%"$tag": "Left"%'
   OR function::text LIKE '%"$tag": "Right"%';

UPDATE function_instances
SET variables = pg_temp.lift_p10a6_walk(variables)
WHERE variables::text LIKE '%"$tag": "Just"%'
   OR variables::text LIKE '%"$tag": "Err"%'
   OR variables::text LIKE '%"$tag": "Ok"%'
   OR variables::text LIKE '%"$tag": "Left"%'
   OR variables::text LIKE '%"$tag": "Right"%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_p10a6_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"$tag": "Just"%'
   OR instance::text LIKE '%"$tag": "Err"%'
   OR instance::text LIKE '%"$tag": "Ok"%'
   OR instance::text LIKE '%"$tag": "Left"%'
   OR instance::text LIKE '%"$tag": "Right"%';

UPDATE views
SET view = pg_temp.lift_p10a6_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$tag": "Just"%'
   OR view::text LIKE '%"$tag": "Err"%'
   OR view::text LIKE '%"$tag": "Ok"%'
   OR view::text LIKE '%"$tag": "Left"%'
   OR view::text LIKE '%"$tag": "Right"%';

UPDATE locus_views
SET view = pg_temp.lift_p10a6_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$tag": "Just"%'
   OR view::text LIKE '%"$tag": "Err"%'
   OR view::text LIKE '%"$tag": "Ok"%'
   OR view::text LIKE '%"$tag": "Left"%'
   OR view::text LIKE '%"$tag": "Right"%';

UPDATE saved_queries
SET query = pg_temp.lift_p10a6_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"$tag": "Just"%'
   OR query::text LIKE '%"$tag": "Err"%'
   OR query::text LIKE '%"$tag": "Ok"%'
   OR query::text LIKE '%"$tag": "Left"%'
   OR query::text LIKE '%"$tag": "Right"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_p10a6_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_p10a6_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"$tag": "Just"%'
   OR type::text LIKE '%"$tag": "Err"%'
   OR type::text LIKE '%"$tag": "Ok"%'
   OR type::text LIKE '%"$tag": "Left"%'
   OR type::text LIKE '%"$tag": "Right"%'
   OR on_submit::text LIKE '%"$tag": "Just"%'
   OR on_submit::text LIKE '%"$tag": "Err"%'
   OR on_submit::text LIKE '%"$tag": "Ok"%'
   OR on_submit::text LIKE '%"$tag": "Left"%'
   OR on_submit::text LIKE '%"$tag": "Right"%';

UPDATE registries
SET module = pg_temp.lift_p10a6_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"$tag": "Just"%'
   OR module::text LIKE '%"$tag": "Err"%'
   OR module::text LIKE '%"$tag": "Ok"%'
   OR module::text LIKE '%"$tag": "Left"%'
   OR module::text LIKE '%"$tag": "Right"%';

COMMIT;
