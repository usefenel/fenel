-- Phase 4 of canonical-maybe — lift `Interval.{lo,hi}?: Bound` to
-- canonical `Maybe<Bound>` (two-slot per-type lift). The TS declaration
-- in `types.ts:91-95` no longer carries `?:`; every persisted Interval
-- must have `lo` and `hi` slots whose values are either
-- `{$tag: "Nothing"}` (unbounded, was absent) or
-- `{$tag: "Just", value: <Bound>}` (bounded, was the raw Bound).
--
-- Why this works: every consumer of `Interval.lo` / `Interval.hi` now
-- discriminates on `$tag` (or peels via `peelMaybeValue`). An absent
-- `lo` / `hi` field on the persisted shape would deserialize to
-- `undefined` and crash the `.$tag` access; pre-lifting at migration
-- time avoids a normalize-on-read code path.
--
-- Lift rule (applies inside any `$interval` constructor):
--
--   {                                            {
--     "$interval": {                               "$interval": {
--                                                    "lo": {"$tag": "Nothing"},
--                                                    "hi": {"$tag": "Nothing"}
--     }                                            }
--   }                                            }
--
--   {                                            {
--     "$interval": {                               "$interval": {
--       "lo": {"value": 0, "inclusive": true}        "lo": {"$tag": "Just",
--                                                            "value": {"value": 0,
--                                                                       "inclusive": true}},
--                                                    "hi": {"$tag": "Nothing"}
--     }                                            }
--   }                                            }
--
--   {                                            {
--     "$interval": {                               "$interval": {
--       "lo": <boundA>,                              "lo": {"$tag": "Just", "value": <boundA>},
--       "hi": <boundB>                               "hi": {"$tag": "Just", "value": <boundB>}
--     }                                            }
--   }                                            }
--
-- Idempotency: skip when `lo` / `hi` is already a JSONB object with key
-- `$tag` (the wrapped form). Mirrors the collision-skip rule from
-- migrations 0051 / 0052 / 0053.
--
-- Scope: Interval lives inside `SetExpr.$interval`, and SetExpr lives in
-- *every* JSONB column that carries Fenel-typed data (typed entity
-- fields with `$where`-constrained value sets, function bodies with
-- inline SetExprs, view specs with cell renders that filter ranges,
-- typeclass instances with constrained methods, …). The 9-column sweep
-- from 0051/0052 is the right scope here.
--
-- Detection: a `$interval`-shaped object is identified by having a
-- `$interval` key whose value is a JSONB object. The walker recurses
-- into all JSONB structure; each `$interval` sub-object gets its `lo`
-- and `hi` fields lifted to the canonical Maybe shape.
--
-- The Fenel-side `Interval lo: a hi: a` declaration in
-- `fenel/modules/engine/set-algebra-deciders.fenel` is polymorphic; only
-- the binding of `a` at use sites changed (already `Maybe Bound` per the
-- Fenel body). No .fenel file needed editing; the TS side is the
-- catching-up surface.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_interval_lo_hi(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  iv jsonb;
  lo_val jsonb;
  hi_val jsonb;
  new_iv jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_interval_lo_hi(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested Intervals lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_interval_lo_hi(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a `$interval` carrier? Detection: has `$interval` key
  -- whose value is a JSONB object.
  iv := result -> '$interval';
  IF iv IS NULL OR jsonb_typeof(iv) <> 'object' THEN RETURN result; END IF;

  lo_val := iv -> 'lo';
  hi_val := iv -> 'hi';

  -- Idempotency: if both lo and hi are already lifted (object with $tag),
  -- nothing to do.
  IF lo_val IS NOT NULL AND jsonb_typeof(lo_val) = 'object' AND (lo_val ? '$tag')
     AND hi_val IS NOT NULL AND jsonb_typeof(hi_val) = 'object' AND (hi_val ? '$tag')
  THEN
    RETURN result;
  END IF;

  -- Lift lo. Three cases: already lifted ($tag present, keep as-is),
  -- absent (build Nothing), present-bound (wrap as Just).
  IF lo_val IS NULL THEN
    lo_val := jsonb_build_object('$tag', 'Nothing');
  ELSIF jsonb_typeof(lo_val) = 'object' AND (lo_val ? '$tag') THEN
    -- already lifted; keep
    lo_val := lo_val;
  ELSE
    lo_val := jsonb_build_object('$tag', 'Just', 'value', lo_val);
  END IF;

  -- Lift hi.
  IF hi_val IS NULL THEN
    hi_val := jsonb_build_object('$tag', 'Nothing');
  ELSIF jsonb_typeof(hi_val) = 'object' AND (hi_val ? '$tag') THEN
    hi_val := hi_val;
  ELSE
    hi_val := jsonb_build_object('$tag', 'Just', 'value', hi_val);
  END IF;

  new_iv := jsonb_build_object('lo', lo_val, 'hi', hi_val);
  result := result || jsonb_build_object('$interval', new_iv);

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries SetExpr-bearing
-- data. Column set mirrors the precedent set by 0051 / 0052.

UPDATE types
SET type = pg_temp.lift_interval_lo_hi(type),
    updated_at = NOW()
WHERE type::text LIKE '%"$interval"%';

UPDATE functions
SET function = pg_temp.lift_interval_lo_hi(function),
    updated_at = NOW()
WHERE function::text LIKE '%"$interval"%';

UPDATE function_instances
SET variables = pg_temp.lift_interval_lo_hi(variables)
WHERE variables::text LIKE '%"$interval"%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_interval_lo_hi(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"$interval"%';

UPDATE views
SET view = pg_temp.lift_interval_lo_hi(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$interval"%';

UPDATE locus_views
SET view = pg_temp.lift_interval_lo_hi(view),
    updated_at = NOW()
WHERE view::text LIKE '%"$interval"%';

UPDATE saved_queries
SET query = pg_temp.lift_interval_lo_hi(query),
    updated_at = NOW()
WHERE query::text LIKE '%"$interval"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_interval_lo_hi(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_interval_lo_hi(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"$interval"%'
   OR on_submit::text LIKE '%"$interval"%';

UPDATE registries
SET module = pg_temp.lift_interval_lo_hi(module),
    updated_at = NOW()
WHERE module::text LIKE '%"$interval"%';

COMMIT;
