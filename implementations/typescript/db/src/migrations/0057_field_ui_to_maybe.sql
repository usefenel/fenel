-- Phase 7b of canonical-maybe — lift `FieldDef.ui?` to canonical
-- `Maybe<EditDisplay>` (thin outer lift over Phase 6's canonical-Maybe
-- inner EditDisplay). The TS declaration in
-- `implementations/typescript/engine/src/types.ts:259-278` no longer
-- carries `?:` on the ui slot; every persisted FieldDef must have `ui`
-- populated as either `{$tag: "Nothing"}` (no edit hints) or
-- `{$tag: "Just", value: <EditDisplay>}` (present hints — the inner
-- EditDisplay was already canonical-Maybe from Phase 6).
--
-- Why this works: every consumer of `field.ui` now uses
-- `peelMaybeValue(field.ui)?.<slot>` or the typed-extract
-- `field.ui.$tag === "Just" && field.ui.value.<slot>` idiom. An absent
-- slot on the persisted shape would deserialize to `undefined` and
-- crash the `.$tag` access; pre-lifting at migration time avoids a
-- normalize-on-read code path.
--
-- Detection: FieldDef is identified by the `name`+`type` co-presence
-- rule (same as 0056 for FieldDef detection, minus the CaseDef branch
-- since CaseDef has no `ui` slot). The walker considers a JSONB
-- object to be a FieldDef carrier when it has BOTH:
--   1. A `name` key (string value), AND
--   2. A sibling `type` key (anything).
--
-- This avoids false-positives on SelectOption (`{value, label}` — no
-- `name`), TypeView (`{name, layout}` — has `name` but no `type`),
-- TypeclassMethod (`{name, params, returns}` — has `name` but no
-- `type` sibling at this object level), Module (`{name, functions,
-- entities, …}` — same), CaseDef (`{name, fields?, label?}` — no
-- `type` sibling), LambdaParam (`{name, type}` — same shape but the
-- transformer-side excludes via call-site context; on the persistence
-- side, lambda params live inside JSON-Logic expression bodies and
-- the walker descends into them; lifting `ui: Nothing` onto a
-- LambdaParam shape is harmless at the JSON level since the runtime
-- doesn't read `lambdaParam.ui`).
--
-- Lift rule:
--
--   { "name": "slug", "type": ..., "ui": { "widget": ..., ... } }
--     →
--   { "name": "slug", "type": ..., "ui": {"$tag":"Just","value":{...}} }
--
--   { "name": "slug", "type": ... }    (no ui slot)
--     →
--   { "name": "slug", "type": ..., "ui": {"$tag":"Nothing"} }
--
-- Idempotency: skip when the ui slot is already a JSONB object with
-- key `$tag` (the wrapped form). Mirrors 0051–0056.
--
-- Watch-out: Phase 7a's migration 0056 ran before this and may have
-- injected `label: Nothing` into FieldDef shapes. Phase 7b walks the
-- same shapes and adds `ui` handling without disturbing label.
-- Migration is additive, not destructive.
--
-- Scope: FieldDef lives inside `$record.fields[]` and `$arrow.params[]`
-- and `$variant.cases[].fields[]`. Any JSONB column carrying typed
-- entity rows, function specs, typeclass instances, TypeViews, or
-- form spec wrappers can contain these. Same 9-column sweep as
-- 0054 / 0055 / 0056.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_one_ui_slot(slot_val jsonb)
RETURNS jsonb AS $body$
BEGIN
  IF slot_val IS NULL THEN
    RETURN jsonb_build_object('$tag', 'Nothing');
  ELSIF jsonb_typeof(slot_val) = 'object' AND (slot_val ? '$tag') THEN
    -- Already lifted; keep as-is.
    RETURN slot_val;
  ELSE
    RETURN jsonb_build_object('$tag', 'Just', 'value', slot_val);
  END IF;
END;
$body$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_ui_walk(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_fielddef boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_ui_walk(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDef lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_ui_walk(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef? Detection: has `name` (string) AND has
  -- `type` (anything). FieldDef.ui sits at this level; CaseDef and
  -- LambdaParam don't carry `ui` slot (no harm in lifting LambdaParam
  -- since the runtime reads `lambdaParam.type` only).
  is_fielddef := jsonb_typeof(result) = 'object'
                 AND (result ? 'name')
                 AND jsonb_typeof(result -> 'name') = 'string'
                 AND (result ? 'type');

  IF is_fielddef THEN
    result := result
      || jsonb_build_object('ui', pg_temp.lift_one_ui_slot(result -> 'ui'));
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that carries FieldDef-bearing data.
-- Column set mirrors the precedent set by 0054 / 0055 / 0056.

UPDATE types
SET type = pg_temp.lift_field_ui_walk(type),
    updated_at = NOW()
WHERE type::text LIKE '%"name":%';

UPDATE functions
SET function = pg_temp.lift_field_ui_walk(function),
    updated_at = NOW()
WHERE function::text LIKE '%"name":%';

UPDATE function_instances
SET variables = pg_temp.lift_field_ui_walk(variables)
WHERE variables::text LIKE '%"name":%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_ui_walk(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"name":%';

UPDATE views
SET view = pg_temp.lift_field_ui_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE locus_views
SET view = pg_temp.lift_field_ui_walk(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE saved_queries
SET query = pg_temp.lift_field_ui_walk(query),
    updated_at = NOW()
WHERE query::text LIKE '%"name":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_ui_walk(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_ui_walk(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"name":%'
   OR on_submit::text LIKE '%"name":%';

UPDATE registries
SET module = pg_temp.lift_field_ui_walk(module),
    updated_at = NOW()
WHERE module::text LIKE '%"name":%';

COMMIT;
