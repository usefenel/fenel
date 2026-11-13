-- Phase 7a of canonical-maybe — lift `FieldDef.label?` and
-- `CaseDef.label?` to canonical `Maybe<LocaleString>` (lockstep
-- two-type cluster opening the FieldDef arc). The TS declarations in
-- `implementations/typescript/engine/src/types.ts:259-278` no longer
-- carry `?:` on the label slot of either FieldDef or CaseDef; every
-- persisted FieldDef and CaseDef must have `label` populated as either
-- `{$tag: "Nothing"}` (absent, was unset) or `{$tag: "Just", value: <raw>}`
-- (present, was the raw value).
--
-- Why this works: every consumer of `field.label` / `case.label` now
-- discriminates on `$tag` (or peels via `peelMaybeValue`). An absent
-- slot on the persisted shape would deserialize to `undefined` and
-- crash the `.$tag` access; pre-lifting at migration time avoids a
-- normalize-on-read code path.
--
-- Detection: FieldDef and CaseDef share the `name:` key as the
-- load-bearing discriminator. The walker considers a JSONB object to
-- be a FieldDef/CaseDef carrier when it has BOTH:
--   1. A `name` key (string value), AND
--   2. Either a sibling `type` key (FieldDef) OR a sibling `fields`
--      key (CaseDef with payload), OR a `label` key already present
--      (nullary CaseDef-with-label).
--
-- This avoids false-positives on SelectOption (`{value, label}` — no
-- `name`), TypeView (`{name, layout}` — has `name` but no `type` /
-- `fields`), TypeclassMethod (`{name, params, returns}` — excluded
-- by absence of `type` or `fields` as sibling AND presence of `params`
-- /`returns`), Module (`{name, functions, entities, …}` — same
-- treatment).
--
-- Bare nullary CaseDef like `{name: "Active"}` (no `fields`, no
-- `label`) IS lifted only when the parent array key is `cases`
-- (variant-context detection). The walker tracks the parent key for
-- this purpose. SelectOption arrays live under `options`, so the
-- parent-key check `cases` rules them out.
--
-- Lift rule:
--
--   { "name": "slug", "label": "Slug", "type": ... }
--     →
--   { "name": "slug", "label": {"$tag":"Just","value":"Slug"}, "type": ... }
--
--   { "name": "createdAt", "type": ... }
--     →
--   { "name": "createdAt", "label": {"$tag":"Nothing"}, "type": ... }
--
--   { "name": "Active" }   (in cases: [...])
--     →
--   { "name": "Active", "label": {"$tag":"Nothing"} }
--
-- Idempotency: skip when the label slot is already a JSONB object
-- with key `$tag` (the wrapped form). Mirrors the collision-skip
-- rule from migrations 0051 / 0052 / 0053 / 0054 / 0055.
--
-- Scope: FieldDef lives inside `$record.fields[]` and `$arrow.params[]`
-- and `$variant.cases[].fields[]`. CaseDef lives inside
-- `$variant.cases[]`. Any JSONB column carrying typed entity rows,
-- function specs, typeclass instances, TypeViews, or form spec
-- wrappers can contain these. The 9-column sweep from 0054 / 0055
-- is the right scope here.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_one_label_slot(slot_val jsonb)
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

CREATE OR REPLACE FUNCTION pg_temp.lift_field_case_label_walk(j jsonb, parent_key text)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_fielddef boolean;
  is_casedef boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element with the parent_key threaded through
  -- so nullary CaseDef inside `cases: [...]` gets the lift even without
  -- a `type:` or `fields:` sibling on the object itself.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_case_label_walk(elem, parent_key)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDef/CaseDef lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_case_label_walk(x.v, x.k)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef? Detection: has `name` (string) AND has
  -- `type` (anything). FieldDef has `type` as a load-bearing required
  -- field; the lone exception is FieldDef-in-CaseDef-payload, which
  -- still requires `type` per the FenelType ADT shape.
  is_fielddef := jsonb_typeof(result) = 'object'
                 AND (result ? 'name')
                 AND jsonb_typeof(result -> 'name') = 'string'
                 AND (result ? 'type');

  -- Is THIS object a CaseDef? Detection: has `name` (string) AND
  -- either has `fields` OR has `label` OR is positioned inside a
  -- `cases:` array (parent_key check).
  is_casedef := jsonb_typeof(result) = 'object'
                AND (result ? 'name')
                AND jsonb_typeof(result -> 'name') = 'string'
                AND NOT is_fielddef
                AND (
                  (result ? 'fields')
                  OR (result ? 'label')
                  OR parent_key = 'cases'
                );

  IF is_fielddef OR is_casedef THEN
    result := result
      || jsonb_build_object('label', pg_temp.lift_one_label_slot(result -> 'label'));
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_case_label(j jsonb)
RETURNS jsonb AS $body$
BEGIN
  RETURN pg_temp.lift_field_case_label_walk(j, NULL);
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that carries FieldDef- or CaseDef-bearing
-- data. Column set mirrors the precedent set by 0054 / 0055.

UPDATE types
SET type = pg_temp.lift_field_case_label(type),
    updated_at = NOW()
WHERE type::text LIKE '%"name":%';

UPDATE functions
SET function = pg_temp.lift_field_case_label(function),
    updated_at = NOW()
WHERE function::text LIKE '%"name":%';

UPDATE function_instances
SET variables = pg_temp.lift_field_case_label(variables)
WHERE variables::text LIKE '%"name":%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_case_label(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"name":%';

UPDATE views
SET view = pg_temp.lift_field_case_label(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE locus_views
SET view = pg_temp.lift_field_case_label(view),
    updated_at = NOW()
WHERE view::text LIKE '%"name":%';

UPDATE saved_queries
SET query = pg_temp.lift_field_case_label(query),
    updated_at = NOW()
WHERE query::text LIKE '%"name":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_case_label(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_case_label(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"name":%'
   OR on_submit::text LIKE '%"name":%';

UPDATE registries
SET module = pg_temp.lift_field_case_label(module),
    updated_at = NOW()
WHERE module::text LIKE '%"name":%';

COMMIT;
