-- Phase 5b of field-meta-collapse — relocate `meta.refFilter` to
-- `ui.refFilter`. Channel-rename migration: the JSON-Logic Expression
-- semantics are unchanged (still evaluated against `{_self, candidate}`
-- to narrow the entity picker's candidate set); only the slot location
-- moves. Production data is expected to carry NON-ZERO rows for this key
-- — the Phase 5 pre-pass enumerated two writer sites (the
-- `profileRelationshipForm` profileBId field + every `isTree`-builtin-
-- class parentId field), so a count > 0 is the expected pre-state.
--
-- Background: `refFilter` is a per-field UX intent — the form context
-- (`_self`) determines the filter, so it's not a per-type story. Its
-- former home (FieldMetadata) was the wrong shape: the metadata sidecar
-- is documented as "form-only metadata that doesn't fit a pure type",
-- but UX hints belong in `FieldDef.ui` next to `widget` / `options` /
-- `helpText` etc. Phase 5b aligns the slot with the existing `EditDisplay`
-- channel and unblocks a Phase 5b.2 follow-up where a
-- `Filterable<X>.defaultFilter` typeclass instance can supply the
-- default filter for tree-shaped entities, with `FieldDef.ui.refFilter`
-- becoming the per-field override slot.
--
-- Lift rule (clones Phase 5a's `0050` shape with one twist — instead of
-- *deleting* `meta.refFilter`, we *copy* the value to `ui.refFilter`
-- first, then drop the key from `meta`):
--
--   {                                            {
--     "type": <unchanged>,                         "type": <unchanged>,
--     "meta": {"refFilter": <expr>, …}      ⇒    "ui":   {<existing ui>, "refFilter": <expr>},
--     "ui":   {<existing ui>}                      "meta": {…}   (or meta key dropped
--                                                              entirely if now empty)
--   }                                            }
--
--   Collision rule on the `ui.refFilter` slot: if the FieldDef already
--   has `ui.refFilter` set (e.g. from a hand-edited row that already
--   uses the new slot), the existing `ui.refFilter` WINS over the
--   incoming `meta.refFilter` value. This preserves the user's
--   newer-shaped intent if any partial migration was in flight.
--
-- Idempotent: a second run on already-migrated rows is a no-op (the
-- `meta.refFilter` gate returns NULL → return result unchanged).
--
-- Pattern: recursive PL/pgSQL JSONB walker, mirroring 0047 / 0048 / 0049
-- / 0050. The 9-column structural sweep is the same; uses
-- `typeclass_instances.instance` (Phase 5a corrected the column list
-- from the precedent `dispatch_registry.instance` — table renamed).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_ref_filter(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  meta jsonb;
  ui jsonb;
  ref_filter jsonb;
  new_meta jsonb;
  new_ui jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_ref_filter(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_ref_filter(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef-shaped carrier of meta.refFilter?
  meta := result -> 'meta';
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN RETURN result; END IF;
  IF NOT (meta ? 'refFilter') THEN RETURN result; END IF;

  ref_filter := meta -> 'refFilter';

  -- Build new ui slot: existing ui (if any) merged with refFilter; existing
  -- ui.refFilter wins on collision (jsonb_build_object first, then `||`
  -- against existing ui — `||` is right-biased, so reverse the precedence).
  ui := result -> 'ui';
  IF ui IS NULL OR jsonb_typeof(ui) <> 'object' THEN
    new_ui := jsonb_build_object('refFilter', ref_filter);
  ELSE
    -- Existing ui.refFilter wins if present; otherwise add it.
    IF ui ? 'refFilter' THEN
      new_ui := ui;
    ELSE
      new_ui := ui || jsonb_build_object('refFilter', ref_filter);
    END IF;
  END IF;

  -- Strip refFilter from meta; drop meta entirely if now empty.
  new_meta := meta - 'refFilter';
  IF new_meta = '{}'::jsonb THEN
    result := result - 'meta';
  ELSE
    result := result || jsonb_build_object('meta', new_meta);
  END IF;

  result := result || jsonb_build_object('ui', new_ui);

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-bearing
-- data. Column set mirrors the precedent set by 0047 / 0048 / 0049 / 0050.

UPDATE types
SET type = pg_temp.lift_field_ref_filter(type),
    updated_at = NOW()
WHERE type::text LIKE '%"refFilter"%';

UPDATE functions
SET function = pg_temp.lift_field_ref_filter(function),
    updated_at = NOW()
WHERE function::text LIKE '%"refFilter"%';

UPDATE function_instances
SET variables = pg_temp.lift_field_ref_filter(variables)
WHERE variables::text LIKE '%"refFilter"%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_field_ref_filter(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"refFilter"%';

UPDATE views
SET view = pg_temp.lift_field_ref_filter(view),
    updated_at = NOW()
WHERE view::text LIKE '%"refFilter"%';

UPDATE locus_views
SET view = pg_temp.lift_field_ref_filter(view),
    updated_at = NOW()
WHERE view::text LIKE '%"refFilter"%';

UPDATE saved_queries
SET query = pg_temp.lift_field_ref_filter(query),
    updated_at = NOW()
WHERE query::text LIKE '%"refFilter"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_ref_filter(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_ref_filter(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"refFilter"%'
   OR on_submit::text LIKE '%"refFilter"%';

UPDATE registries
SET module = pg_temp.lift_field_ref_filter(module),
    updated_at = NOW()
WHERE module::text LIKE '%"refFilter"%';

COMMIT;
