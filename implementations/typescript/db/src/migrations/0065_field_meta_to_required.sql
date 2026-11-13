-- Phase 9 of canonical-maybe — lift `FieldDef.meta?` to mandatory
-- `FieldMetadata` with `{}` as the natural absence-marker (Tier B —
-- codec-boundary Undefinable-dispatch, not Tier A semantic-absence).
-- The TS declaration in
-- `implementations/typescript/engine/src/types.ts:295-302` no longer
-- carries `?:` on the meta slot; every persisted FieldDef must have
-- `meta` populated as either `{}` (no sidecar data — the natural
-- absence-marker; codec's `isErasableType(FieldMetadata) === true`
-- via the Phase 8 `fieldMetadataUndefinable` preview-instance means
-- the slot can be omitted from JSON Schema's `required[]`) or
-- `{...}` with whatever pre-existing sidecar data the row already
-- carried.
--
-- Why this works: every reader either uses the `fieldMeta(field)`
-- accessor (which now reads `f.meta` directly, no `?? {}` fallback —
-- the accessor's defensive fallback retired in lockstep with this
-- migration per Phase 9 Open Q1 Option A) or reads `field.meta`
-- directly via `field.meta.X` (now non-optional). An absent slot on
-- the persisted shape would deserialize to `undefined` and crash any
-- direct field access; pre-lifting at migration time avoids a
-- normalize-on-read code path.
--
-- Detection: FieldDef is identified by the `name`+`type` co-presence
-- rule (same as 0056 / 0057 / 0058). The walker considers a JSONB
-- object to be a FieldDef carrier when it has BOTH:
--   1. A `name` key (string value), AND
--   2. A sibling `type` key (anything).
--
-- Same false-positive guard analysis as 0057 / 0058: SelectOption /
-- TypeView / TypeclassMethod / Module / CaseDef are all skipped by
-- absence of `type:` sibling. LambdaParam matches the rule but its
-- persistence-side `meta` injection is harmless at the JSON level
-- (runtime reads `lambdaParam.{name,type}` only; never `lambdaParam.
-- meta`). The TS compiler catches LambdaParam mis-injections at
-- code-author time, not at the JSON layer.
--
-- Lift rule:
--
--   { "name": "x", "type": ... }    (no meta slot)
--     →
--   { "name": "x", "type": ..., "meta": {} }
--
--   { "name": "x", "type": ..., "meta": {"unit": ...} }
--     →
--   { "name": "x", "type": ..., "meta": {"unit": ...} }   (preserved)
--
-- Idempotency: skip when the meta slot is already present (any
-- value). Mirrors 0051–0058.
--
-- Watch-out: 9's walker walks the same shapes that 7a/7b/7c already
-- walked, and ADDS `meta` handling without disturbing label/ui/default.
-- Migration is additive, not destructive.
--
-- Scope: same 9-column sweep as 0054 / 0055 / 0056 / 0057 / 0058.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_meta_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_fielddef boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_meta_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDef lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_meta_walk(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef? Detection: has `name` (string) AND has
  -- `type` (anything). Same rule as 0056 / 0057 / 0058 FieldDef branch.
  is_fielddef := jsonb_typeof(result) = 'object'
                 AND (result ? 'name')
                 AND jsonb_typeof(result -> 'name') = 'string'
                 AND (result ? 'type');

  IF is_fielddef THEN
    -- Inject `meta: {}` only if the slot is absent. If present, preserve
    -- whatever the row already has (any record shape is structurally
    -- valid as `FieldMetadata`).
    IF NOT (result ? 'meta') THEN
      result := result || jsonb_build_object('meta', '{}'::jsonb);
    END IF;
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that carries FieldDef-bearing data.
-- Column set mirrors the precedent set by 0054 / 0055 / 0056 / 0057 / 0058.

UPDATE types
SET type = pg_temp.lift_field_meta_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"name":%';

UPDATE functions
SET function = pg_temp.lift_field_meta_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"name":%';

UPDATE function_instances
SET variables = pg_temp.lift_field_meta_walk(variables)
WHERE variables::text LIKE '%"name":%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_meta_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"name":%';

UPDATE views
SET view = pg_temp.lift_field_meta_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE locus_views
SET view = pg_temp.lift_field_meta_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE saved_queries
SET query = pg_temp.lift_field_meta_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"name":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_meta_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_meta_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"name":%'
   OR on_submit::text LIKE '%"name":%';

UPDATE registries
SET module = pg_temp.lift_field_meta_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"name":%';

COMMIT;
