-- Phase 6 of canonical-maybe — lift `EditDisplay.{widget, placeholder,
-- helpText, options, columns, refFilter}?` to canonical `Maybe<...>`
-- (6-slot FieldRenderer-heavy cluster lift). The TS declaration in
-- `implementations/typescript/engine/src/types.ts:650-690` no longer
-- carries `?:` on those six slots; every persisted EditDisplay must
-- have those slots populated as either `{$tag: "Nothing"}` (absent,
-- was unset) or `{$tag: "Just", value: <raw>}` (present, was the raw
-- value).
--
-- The out-of-scope sibling slots (`prefix`, `suffix`, `format`) stay
-- `?:` — they're paired with their `ReadDisplay` counterparts and
-- defer to a later phase. The walker MUST NOT touch those slots.
--
-- Why this works: every consumer of `field.ui?.widget` etc. now
-- discriminates on `$tag` (or peels via `peelMaybeValue`). An absent
-- slot on the persisted shape would deserialize to `undefined` and
-- crash the `.$tag` access; pre-lifting at migration time avoids a
-- normalize-on-read code path.
--
-- Lift rule (applies inside any `ui` or `edit` carrier object —
-- detection by parent key, NOT by slot-name presence; the parent-key
-- signal is collision-proof per Phase 2's surprise log #2):
--
--   "ui": {                                  "ui": {
--     "widget": "textarea"                     "widget": {"$tag": "Just", "value": "textarea"},
--                                              "placeholder": {"$tag": "Nothing"},
--                                              "helpText": {"$tag": "Nothing"},
--                                              "options": {"$tag": "Nothing"},
--                                              "columns": {"$tag": "Nothing"},
--                                              "refFilter": {"$tag": "Nothing"}
--   }                                        }
--
--   "ui": {                                  "ui": {
--     "widget": "select",                      "widget": {"$tag": "Just", "value": "select"},
--     "options": [{"value": "a"}, …]           "placeholder": {"$tag": "Nothing"},
--                                              "helpText": {"$tag": "Nothing"},
--                                              "options": {"$tag": "Just", "value": [{"value": "a"}, …]},
--                                              "columns": {"$tag": "Nothing"},
--                                              "refFilter": {"$tag": "Nothing"}
--   }                                        }
--
--   "edit": {                                "edit": {
--     "format": "datetime",                    "format": "datetime",
--                                              "widget": {"$tag": "Nothing"},
--                                              "placeholder": {"$tag": "Nothing"},
--                                              "helpText": {"$tag": "Nothing"},
--                                              "options": {"$tag": "Nothing"},
--                                              "columns": {"$tag": "Nothing"},
--                                              "refFilter": {"$tag": "Nothing"}
--   }                                        }
--
-- Idempotency: skip when each of the 6 target slots is already a
-- JSONB object with key `$tag` (the wrapped form). Mirrors the
-- collision-skip rule from migrations 0051 / 0052 / 0053 / 0054.
--
-- Scope: EditDisplay lives inside `FieldDef.ui` and inside
-- `TypeView.display.edit`, both of which can be nested inside any
-- JSONB column that carries typed entity rows, function specs,
-- typeclass instances, TypeViews, or form spec wrappers. The 9-column
-- sweep from 0054 is the right scope here.
--
-- Detection: a JSONB object is treated as an EditDisplay carrier
-- when it appears under a parent key of `ui` or `edit`. The walker
-- recurses into all JSONB structure; only when it crosses a parent
-- key of `ui` or `edit` (and the value is an object) does it apply
-- the 6-slot lift. Other `ui:` / `edit:` usages elsewhere in the
-- JSONB tree would pass through with their existing shape preserved.
--
-- The Fenel-side schema for `FieldDef.ui` lives inside
-- `system-entities.ts` as a structural-record literal, not as a
-- separately-registered ADT. No `.fenel` lockstep edit needed.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_one_editdisplay_slot(slot_val jsonb)
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

CREATE OR REPLACE FUNCTION pg_temp.lift_editdisplay_walk(j jsonb, parent_key text)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_editdisplay boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element with no parent-key context.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_editdisplay_walk(elem, NULL)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested EditDisplays lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_editdisplay_walk(x.v, x.k)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object an EditDisplay carrier? Detection: parent_key is
  -- `ui` or `edit` AND object is non-empty (avoid false-positive on
  -- empty `{}` shells).
  is_editdisplay := (parent_key IN ('ui', 'edit')) AND (jsonb_typeof(result) = 'object');
  IF NOT is_editdisplay THEN RETURN result; END IF;

  -- Lift each of the 6 target slots. The out-of-scope slots
  -- (`prefix`, `suffix`, `format`) and any unknown keys pass through
  -- unchanged from the recursive pass above.
  result := result
    || jsonb_build_object('widget',     pg_temp.lift_one_editdisplay_slot(result -> 'widget'))
    || jsonb_build_object('placeholder',pg_temp.lift_one_editdisplay_slot(result -> 'placeholder'))
    || jsonb_build_object('helpText',   pg_temp.lift_one_editdisplay_slot(result -> 'helpText'))
    || jsonb_build_object('options',    pg_temp.lift_one_editdisplay_slot(result -> 'options'))
    || jsonb_build_object('columns',    pg_temp.lift_one_editdisplay_slot(result -> 'columns'))
    || jsonb_build_object('refFilter',  pg_temp.lift_one_editdisplay_slot(result -> 'refFilter'));

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.lift_editdisplay(j jsonb)
RETURNS jsonb AS $body$
BEGIN
  RETURN pg_temp.lift_editdisplay_walk(j, NULL);
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-
-- bearing or TypeView-bearing data. Column set mirrors the precedent
-- set by 0054.

UPDATE types
SET type = pg_temp.lift_editdisplay(type),
    updated_at = NOW()
WHERE type::text LIKE '%"ui":%'
   OR type::text LIKE '%"edit":%';

UPDATE functions
SET function = pg_temp.lift_editdisplay(function),
    updated_at = NOW()
WHERE function::text LIKE '%"ui":%'
   OR function::text LIKE '%"edit":%';

UPDATE function_instances
SET variables = pg_temp.lift_editdisplay(variables)
WHERE variables::text LIKE '%"ui":%'
   OR variables::text LIKE '%"edit":%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_editdisplay(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"ui":%'
   OR instance::text LIKE '%"edit":%';

UPDATE views
SET view = pg_temp.lift_editdisplay(view),
    updated_at = NOW()
WHERE view::text LIKE '%"ui":%'
   OR view::text LIKE '%"edit":%';

UPDATE locus_views
SET view = pg_temp.lift_editdisplay(view),
    updated_at = NOW()
WHERE view::text LIKE '%"ui":%'
   OR view::text LIKE '%"edit":%';

UPDATE saved_queries
SET query = pg_temp.lift_editdisplay(query),
    updated_at = NOW()
WHERE query::text LIKE '%"ui":%'
   OR query::text LIKE '%"edit":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_editdisplay(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_editdisplay(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"ui":%'
   OR type::text LIKE '%"edit":%'
   OR on_submit::text LIKE '%"ui":%'
   OR on_submit::text LIKE '%"edit":%';

UPDATE registries
SET module = pg_temp.lift_editdisplay(module),
    updated_at = NOW()
WHERE module::text LIKE '%"ui":%'
   OR module::text LIKE '%"edit":%';

COMMIT;
