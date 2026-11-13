-- Phase 6.5 of canonical-maybe — lift the full `ReadDisplay` 9-slot
-- surface AND the paired `EditDisplay.{prefix,suffix,format}?` trio
-- to canonical `Maybe<...>`. The TS declarations in
-- `implementations/typescript/engine/src/types.ts` no longer carry
-- `?:` on any of these 12 slots; every persisted ReadDisplay /
-- EditDisplay must have them populated as either `{$tag: "Nothing"}`
-- (absent, was unset) or `{$tag: "Just", value: <raw>}` (present, was
-- the raw value).
--
-- Phase 6.5 closes the ReadDisplay/EditDisplay Tier-A surface fully:
-- both display types are now 100% canonical Maybe on their inner
-- Tier-A slots (the outer `display.{read,edit}?` slots stay `?:` for
-- now — analogous to FieldDef.ui Phase 7b's outer-over-Phase-6
-- pattern).
--
-- Two parent-key contexts, twelve slot lifts total:
--
--   `read:` parent → 9 ReadDisplay slots
--     format, transform, colorMap, labelMap, icon, emptyText,
--     prefix, suffix, refTemplate
--
--   `ui:` / `edit:` parent → 3 EditDisplay trio extension
--     prefix, suffix, format
--     (Phase 6's 6 slots widget/placeholder/helpText/options/columns/
--      refFilter were already lifted by migration 0055 — idempotent here.)
--
-- Detection: parent-key gate, identical strategy to 0055. The walker
-- recurses through all JSONB structure; only at the moment it crosses
-- a parent key of `read:` (ReadDisplay) or `ui:` / `edit:`
-- (EditDisplay) does it apply the per-slot lift rule. The `format`
-- slot appears on BOTH ReadDisplay AND EditDisplay; parent-key context
-- routes correctly without cross-contamination.
--
-- Idempotency: skip when a target slot is already a JSONB object with
-- key `$tag` (the wrapped form). Mirrors 0051–0058's collision-skip.
--
-- Scope: ReadDisplay lives inside `TypeView.display.read`; EditDisplay
-- inside `FieldDef.ui` and `TypeView.display.edit`. Both are reachable
-- through any of the 9 JSONB columns swept by 0054–0058.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_one_readdisplay_slot(slot_val jsonb)
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

CREATE OR REPLACE FUNCTION pg_temp.lift_readdisplay_walk(j jsonb, parent_key text)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  is_read boolean;
  is_edit boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element with no parent-key context.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_readdisplay_walk(elem, NULL)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested ReadDisplay/
  -- EditDisplay carriers lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_readdisplay_walk(x.v, x.k)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  is_read := (parent_key = 'read') AND (jsonb_typeof(result) = 'object');
  is_edit := (parent_key IN ('ui', 'edit')) AND (jsonb_typeof(result) = 'object');

  -- ReadDisplay carrier: lift all 9 ReadDisplay slots.
  IF is_read THEN
    result := result
      || jsonb_build_object('format',      pg_temp.lift_one_readdisplay_slot(result -> 'format'))
      || jsonb_build_object('transform',   pg_temp.lift_one_readdisplay_slot(result -> 'transform'))
      || jsonb_build_object('colorMap',    pg_temp.lift_one_readdisplay_slot(result -> 'colorMap'))
      || jsonb_build_object('labelMap',    pg_temp.lift_one_readdisplay_slot(result -> 'labelMap'))
      || jsonb_build_object('icon',        pg_temp.lift_one_readdisplay_slot(result -> 'icon'))
      || jsonb_build_object('emptyText',   pg_temp.lift_one_readdisplay_slot(result -> 'emptyText'))
      || jsonb_build_object('prefix',      pg_temp.lift_one_readdisplay_slot(result -> 'prefix'))
      || jsonb_build_object('suffix',      pg_temp.lift_one_readdisplay_slot(result -> 'suffix'))
      || jsonb_build_object('refTemplate', pg_temp.lift_one_readdisplay_slot(result -> 'refTemplate'));
  END IF;

  -- EditDisplay carrier: lift the 3 trio slots (prefix/suffix/format).
  -- Phase 6's 6 slots are already canonical from migration 0055; the
  -- lift helper's `$tag`-presence gate makes the call idempotent.
  IF is_edit THEN
    result := result
      || jsonb_build_object('prefix', pg_temp.lift_one_readdisplay_slot(result -> 'prefix'))
      || jsonb_build_object('suffix', pg_temp.lift_one_readdisplay_slot(result -> 'suffix'))
      || jsonb_build_object('format', pg_temp.lift_one_readdisplay_slot(result -> 'format'));
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.lift_readdisplay(j jsonb)
RETURNS jsonb AS $body$
BEGIN
  RETURN pg_temp.lift_readdisplay_walk(j, NULL);
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries ReadDisplay
-- or EditDisplay payloads. Column set mirrors 0054–0058.

UPDATE types
SET type = pg_temp.lift_readdisplay(type),
    updated_at = NOW()
WHERE type::text LIKE '%"read":%'
   OR type::text LIKE '%"ui":%'
   OR type::text LIKE '%"edit":%';

UPDATE functions
SET function = pg_temp.lift_readdisplay(function),
    updated_at = NOW()
WHERE function::text LIKE '%"read":%'
   OR function::text LIKE '%"ui":%'
   OR function::text LIKE '%"edit":%';

UPDATE function_instances
SET variables = pg_temp.lift_readdisplay(variables)
WHERE variables::text LIKE '%"read":%'
   OR variables::text LIKE '%"ui":%'
   OR variables::text LIKE '%"edit":%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_readdisplay(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"read":%'
   OR instance::text LIKE '%"ui":%'
   OR instance::text LIKE '%"edit":%';

UPDATE views
SET view = pg_temp.lift_readdisplay(view),
    updated_at = NOW()
WHERE view::text LIKE '%"read":%'
   OR view::text LIKE '%"ui":%'
   OR view::text LIKE '%"edit":%';

UPDATE locus_views
SET view = pg_temp.lift_readdisplay(view),
    updated_at = NOW()
WHERE view::text LIKE '%"read":%'
   OR view::text LIKE '%"ui":%'
   OR view::text LIKE '%"edit":%';

UPDATE saved_queries
SET query = pg_temp.lift_readdisplay(query),
    updated_at = NOW()
WHERE query::text LIKE '%"read":%'
   OR query::text LIKE '%"ui":%'
   OR query::text LIKE '%"edit":%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_readdisplay(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_readdisplay(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"read":%'
   OR type::text LIKE '%"ui":%'
   OR type::text LIKE '%"edit":%'
   OR on_submit::text LIKE '%"read":%'
   OR on_submit::text LIKE '%"ui":%'
   OR on_submit::text LIKE '%"edit":%';

UPDATE registries
SET module = pg_temp.lift_readdisplay(module),
    updated_at = NOW()
WHERE module::text LIKE '%"read":%'
   OR module::text LIKE '%"ui":%'
   OR module::text LIKE '%"edit":%';

COMMIT;
