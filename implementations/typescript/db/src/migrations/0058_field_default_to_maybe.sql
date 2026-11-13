-- Phase 7c of canonical-maybe — lift `FieldDef.default?` to canonical
-- `Maybe<unknown>` (closes the FieldDef arc; only `meta?` remains as
-- `?:`, scheduled for Phase 9 / Tier B). The TS declaration in
-- `implementations/typescript/engine/src/types.ts:259-289` no longer
-- carries `?:` on the default slot; every persisted FieldDef must have
-- `default` populated as either `{$tag: "Nothing"}` (no explicit default;
-- consumer falls back to `defaultValueFor(field.type)`) or
-- `{$tag: "Just", value: <unknown>}` (explicit default — wraps ANY shape:
-- number, string, boolean, object, array, null).
--
-- Why this works: every consumer of `field.default` now uses
-- `field.default.$tag === "Just" ? field.default.value : <fallback>`
-- or the `peelMaybeValue(field.default)` cascade. An absent slot on the
-- persisted shape would deserialize to `undefined` and crash the
-- `.$tag` access; pre-lifting at migration time avoids a normalize-on-
-- read code path.
--
-- Detection: FieldDef is identified by the `name`+`type` co-presence
-- rule (same as 0056 / 0057). The walker considers a JSONB object to
-- be a FieldDef carrier when it has BOTH:
--   1. A `name` key (string value), AND
--   2. A sibling `type` key (anything).
--
-- Same false-positive guard analysis as 0057: SelectOption / TypeView /
-- TypeclassMethod / Module / CaseDef are all skipped by absence of
-- `type:` sibling. LambdaParam matches the rule but its persistence-
-- side `default` injection is harmless at the JSON level (runtime reads
-- `lambdaParam.{name,type}` only). The TS compiler catches LambdaParam
-- mis-injections at code-author time, not at the JSON layer.
--
-- Lift rule:
--
--   { "name": "maxAttempts", "type": ..., "default": 3 }
--     →
--   { "name": "maxAttempts", "type": ..., "default": {"$tag":"Just","value":3} }
--
--   { "name": "slug", "type": ... }    (no default slot)
--     →
--   { "name": "slug", "type": ..., "default": {"$tag":"Nothing"} }
--
--   { "name": "x", "type": ..., "default": null }
--     →
--   { "name": "x", "type": ..., "default": {"$tag":"Just","value":null} }
--   (Explicit-null is wrapped — distinguishable from Nothing via $tag,
--    same semantic the typed-extract idiom relies on. Most consumers
--    fall through to defaultValueFor for either shape, but the
--    distinction is preserved at storage.)
--
-- Idempotency: skip when the default slot is already a JSONB object
-- with key `$tag` (the wrapped form). Mirrors 0051–0057.
--
-- Watch-out: 7c's walker walks the same shapes that 7a (label) and 7b
-- (ui) walked, and ADDS `default` handling without disturbing label or
-- ui. Migration is additive, not destructive.
--
-- `unknown`-typed slot caveat: unlike `EditDisplay` (Phase 7b's inner
-- shape was canonical Maybe per Phase 6), `default: unknown` accepts ANY
-- shape. The walker wraps the whole stored value verbatim in
-- `{$tag: "Just", value: <raw>}`. No inner-shape inspection.
--
-- Scope: same 9-column sweep as 0054 / 0055 / 0056 / 0057.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_one_default_slot(slot_val jsonb)
RETURNS jsonb AS $body$
BEGIN
  IF slot_val IS NULL THEN
    RETURN jsonb_build_object('$tag', 'Nothing');
  ELSIF jsonb_typeof(slot_val) = 'object' AND (slot_val ? '$tag') THEN
    -- Already lifted; keep as-is.
    RETURN slot_val;
  ELSE
    -- Wrap any other shape (number, string, boolean, object, array,
    -- JSONB null) in Just(...). Note: JSONB stores SQL NULL as the
    -- absent branch (handled above), but a JSON `null` literal stored
    -- inside a parent object is jsonb_typeof = 'null' and lands here —
    -- correctly wrapped as Just(null) per the explicit-null semantic.
    RETURN jsonb_build_object('$tag', 'Just', 'value', slot_val);
  END IF;
END;
$body$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_default_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_fielddef boolean;
  default_input jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_default_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDef lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_default_walk(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef? Detection: has `name` (string) AND has
  -- `type` (anything). Same rule as 0056 / 0057 FieldDef branch.
  is_fielddef := jsonb_typeof(result) = 'object'
                 AND (result ? 'name')
                 AND jsonb_typeof(result -> 'name') = 'string'
                 AND (result ? 'type');

  IF is_fielddef THEN
    -- Read the value at `default` BEFORE recursion clobbered it (the
    -- jsonb_object_agg above would have walked into `default` and tried
    -- to treat it as a FieldDef carrier, but the lifter at this level
    -- expects the raw value). For most defaults the recursion is a no-op
    -- (literals don't match the FieldDef detector), but defaults that
    -- happen to be a record literal with a `name` + `type` sibling
    -- would get a spurious lift. Restore the un-walked value.
    default_input := j -> 'default';
    result := result
      || jsonb_build_object('default', pg_temp.lift_one_default_slot(default_input));
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that carries FieldDef-bearing data.
-- Column set mirrors the precedent set by 0054 / 0055 / 0056 / 0057.

UPDATE types
SET type = pg_temp.lift_field_default_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"name":%';

UPDATE functions
SET function = pg_temp.lift_field_default_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"name":%';

UPDATE function_instances
SET variables = pg_temp.lift_field_default_walk(variables)
WHERE variables::text LIKE '%"name":%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_default_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"name":%';

UPDATE views
SET view = pg_temp.lift_field_default_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE locus_views
SET view = pg_temp.lift_field_default_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE saved_queries
SET query = pg_temp.lift_field_default_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"name":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_default_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_default_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"name":%'
   OR on_submit::text LIKE '%"name":%';

UPDATE registries
SET module = pg_temp.lift_field_default_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"name":%';

COMMIT;
