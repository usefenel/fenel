-- Phase 10a-5d — dispatch fnId V2 → canonical rename + legacy 3-arg shape lift.
--
-- After Phase 10a-5d the dispatch surface collapses to two fnIds with
-- typed-DispatchKey signatures:
--   dispatch:register specTypeId key:DispatchKey methods scope -> ()
--   dispatch:lookup   specTypeId key:DispatchKey            -> LookupResult
--
-- The pre-rename surface (`dispatch:registerV2` / `dispatch:lookupV2`)
-- already carried the DispatchKey signature; the legacy bare-string
-- `dispatch:register` (args: List<String>) + `dispatch:lookup` (target:
-- String) shapes have been retired. This migration walks persisted
-- `{call: [...]}` shapes and:
--
--   1. Renames V2 → canonical
--      `{call: ["dispatch:registerV2", spec, key, methods, scope]}`
--        → `{call: ["dispatch:register", spec, key, methods, scope]}`
--      `{call: ["dispatch:lookupV2", spec, key]}`
--        → `{call: ["dispatch:lookup", spec, key]}`
--
--   2. Lifts legacy 3-arg/5-arg shape to canonical typed-DispatchKey
--      `{call: ["dispatch:register", spec, [target], methods, scope]}`
--        → `{call: ["dispatch:register", spec, {$tag: "ByType", target}, methods, scope]}`
--      `{call: ["dispatch:lookup", spec, target_string]}`
--        → `{call: ["dispatch:lookup", spec, {$tag: "ByType", target: target_string}]}`
--
-- Idempotent — skip when the `key` slot is already a DispatchKey-shaped
-- object (`{$tag: "ByType"|"ByValue"|"ByPattern", …}`).
--
-- Same 9-column sweep as 0054..0062.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_p10a5d_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  call_args jsonb;
  fn_id text;
  key_slot jsonb;
  lifted_key jsonb;
  target_str text;
  new_call jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse over elements.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_p10a5d_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Recurse into all values first (post-order rewrite).
  result := (
    SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_p10a5d_walk(x.v)), '{}'::jsonb)
    FROM jsonb_each(j) AS x(k, v)
  );

  -- Detect a `{call: [fnId, ...args]}` shape with a dispatch fnId in the
  -- head. Other call shapes pass through unchanged.
  IF result ? 'call' THEN
    call_args := result -> 'call';
    IF jsonb_typeof(call_args) = 'array'
       AND jsonb_array_length(call_args) >= 1
       AND jsonb_typeof(call_args -> 0) = 'string'
    THEN
      fn_id := call_args ->> 0;

      -- 1. V2 → canonical rename (already-DispatchKey-shaped key).
      IF fn_id = 'dispatch:registerV2' THEN
        new_call := jsonb_set(call_args, '{0}', '"dispatch:register"'::jsonb);
        result := jsonb_set(result, '{call}', new_call);

      ELSIF fn_id = 'dispatch:lookupV2' THEN
        new_call := jsonb_set(call_args, '{0}', '"dispatch:lookup"'::jsonb);
        result := jsonb_set(result, '{call}', new_call);

      -- 2. Legacy bare-string `dispatch:register` (args: List<String>).
      -- Shape: ["dispatch:register", spec, [target], methods, scope].
      -- Lift `[target]` → `{$tag: "ByType", target}` when args[2] is a
      -- bare array; skip when already DispatchKey-shaped.
      ELSIF fn_id = 'dispatch:register' AND jsonb_array_length(call_args) >= 3 THEN
        key_slot := call_args -> 2;
        IF jsonb_typeof(key_slot) = 'array'
           AND jsonb_array_length(key_slot) >= 1
           AND jsonb_typeof(key_slot -> 0) = 'string'
        THEN
          target_str := key_slot ->> 0;
          lifted_key := jsonb_build_object(
            '$tag', 'ByType',
            'target', target_str
          );
          new_call := jsonb_set(call_args, '{2}', lifted_key);
          result := jsonb_set(result, '{call}', new_call);
        END IF;

      -- 3. Legacy bare-string `dispatch:lookup` (target: String).
      -- Shape: ["dispatch:lookup", spec, target_string].
      -- Lift `target_string` → `{$tag: "ByType", target: target_string}`
      -- when args[2] is a bare string; skip when already DispatchKey.
      ELSIF fn_id = 'dispatch:lookup' AND jsonb_array_length(call_args) >= 3 THEN
        key_slot := call_args -> 2;
        IF jsonb_typeof(key_slot) = 'string' THEN
          target_str := key_slot #>> '{}';
          lifted_key := jsonb_build_object(
            '$tag', 'ByType',
            'target', target_str
          );
          new_call := jsonb_set(call_args, '{2}', lifted_key);
          result := jsonb_set(result, '{call}', new_call);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column. LIKE-filter on dispatch fnId substrings to
-- filter the row-scan; the walker is idempotent so over-filtering only
-- costs scan time.

UPDATE types
SET type = pg_temp.lift_p10a5d_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"dispatch:register%'
   OR type::text LIKE '%"dispatch:lookup%';

UPDATE functions
SET function = pg_temp.lift_p10a5d_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"dispatch:register%'
   OR function::text LIKE '%"dispatch:lookup%';

UPDATE function_instances
SET variables = pg_temp.lift_p10a5d_walk(variables)
WHERE variables::text LIKE '%"dispatch:register%'
   OR variables::text LIKE '%"dispatch:lookup%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_p10a5d_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"dispatch:register%'
   OR instance::text LIKE '%"dispatch:lookup%';

UPDATE views
SET view = pg_temp.lift_p10a5d_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"dispatch:register%'
   OR view::text LIKE '%"dispatch:lookup%';

UPDATE locus_views
SET view = pg_temp.lift_p10a5d_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"dispatch:register%'
   OR view::text LIKE '%"dispatch:lookup%';

UPDATE saved_queries
SET query = pg_temp.lift_p10a5d_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"dispatch:register%'
   OR query::text LIKE '%"dispatch:lookup%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_p10a5d_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_p10a5d_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"dispatch:register%'
   OR type::text LIKE '%"dispatch:lookup%'
   OR on_submit::text LIKE '%"dispatch:register%'
   OR on_submit::text LIKE '%"dispatch:lookup%';

UPDATE registries
SET module = pg_temp.lift_p10a5d_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"dispatch:register%'
   OR module::text LIKE '%"dispatch:lookup%';

COMMIT;
