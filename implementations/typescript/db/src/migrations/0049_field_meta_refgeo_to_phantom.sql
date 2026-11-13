-- Phase 4 of field-meta-collapse — lift `meta.refGeoResolution` sidecar key
-- into the field's type as a `Place : GeoLevel -> Type` $tagged-phantom
-- wrapper. Mirrors the Phase 3 migration `0048` (Q for units) applied to
-- the tree-hierarchical-types domain.
--
-- Background: `meta.refGeoResolution` was an undeclared string-keyed
-- back-door key the frontend field-editor wrote into FieldMetadata
-- alongside a `$tagged Id<country>` type to mean "this is actually a
-- Place at level X" (city / postal_code / street / address). The
-- validator never read it. Phase 4 retires the sidecar by lifting the
-- precision level into the type itself via `Place : GeoLevel -> Type`
-- (places.ts:Place). See `design/tree-hierarchical-types.md` for the
-- encoding decision + the 5-criteria evaluation matrix.
--
-- Lift rule:
--
--   {                                            {
--     "type": {                                    "type": {
--       "$tagged": {                                 "$tagged": {
--         "value": {"$named": "Id"},                   "value": {"$named": "GeoPath"},
--         "phantom": {                                 "phantom": {
--           "$refined": {                                "$refined": {
--             "base": {"$named": "String"},                "base": {"$named": "GeoLevel"},
--             "set": {"$enum": ["country"]}                "set": {"$enum": [{"$tag": "GeoCity"}]}
--           }                                  ⇒         }
--         }                                            }
--       }                                            }
--     },                                           },
--     "meta": {"refGeoResolution": "city"}         meta key dropped (entire
--   }                                              meta removed if empty)
--                                                }
--
-- The `meta.refGeoResolution` string-cased levels ("country" /
-- "region" / "city" / "postal_code" / "street" / "address") map to
-- typed GeoLevel constructors (`{$tag: "GeoCountry"}` / … /
-- `{$tag: "GeoAddress"}`). The `Geo` prefix on constructor names
-- avoids collision with email module's `Address` record in the
-- engine's global `_constructors` map.
--
-- Skip when `meta.refGeoResolution` is "country" or absent: the type
-- is already a plain `Id<country>`; no Place wrapper needed (Country-
-- only Place would render identically). The editor's write path
-- emits `Place(GeoCountry)` for country-level explicitly, but for
-- the migration the cheaper no-op is preferred for those rows.
-- (Actually, since the design note + editor both unconditionally use
-- Place for the place field type, the migration lifts country-level
-- too — keeps wire shape consistent across migrated vs newly-written
-- rows.)
--
-- Skip non-Id-country bases: only lift when the inner $tagged is
-- `$tagged { value: {$named: "Id"}, phantom: {... $enum: ["country"]} }`.
-- Other shapes left alone; read-path fallback catches.
--
-- Legacy `{$maybe: <inner>}` shorthand is peeled and re-wrapped (the
-- inner type carries the Place wrap, not the Maybe outer). The
-- canonical Maybe encoding (`$variant {Nothing | Just}`) is NOT
-- peeled — those rows keep their `meta` key + load via the read-path
-- soft-fallback. Same disposition as Phase 2 / Phase 3.
--
-- Idempotent: a second run on already-lifted rows is a no-op (the
-- meta key is absent → the lift gate returns NULL → return result
-- unchanged).
--
-- Pattern: recursive PL/pgSQL JSONB walker, mirroring 0047 / 0048.
--
-- VALUE-ROW LIFT (NEW vs 0047 / 0048):
--
-- Phases 2-3 lifted only type shapes. Phase 4 also lifts VALUES:
-- legacy stored `Id<country>` strings need to wrap into a `GeoPath`
-- record. The migration sketches that value-row lift here but does
-- NOT execute it in this commit — the entity_instances walker
-- requires per-entity-schema introspection (find which fields have
-- Place type, then walk matching rows). Deferred to a Phase 4
-- follow-up commit; existing values continue loading via the read-
-- path fallback in the editor.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_field_refgeo(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  meta jsonb;
  type_val jsonb;
  refgeo jsonb;
  level_str text;
  level_tag text;
  was_maybe boolean;
  inner_type jsonb;
  is_country_ref boolean;
  new_inner jsonb;
  new_type jsonb;
  new_meta jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_field_refgeo(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested FieldDefs lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_field_refgeo(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object a FieldDef carrying meta.refGeoResolution?
  meta := result -> 'meta';
  type_val := result -> 'type';
  IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN RETURN result; END IF;
  IF type_val IS NULL THEN RETURN result; END IF;

  refgeo := meta -> 'refGeoResolution';
  IF refgeo IS NULL OR jsonb_typeof(refgeo) <> 'string' THEN RETURN result; END IF;

  level_str := refgeo #>> '{}';
  level_tag := CASE level_str
    WHEN 'country'     THEN 'GeoCountry'
    WHEN 'region'      THEN 'GeoRegion'
    WHEN 'city'        THEN 'GeoCity'
    WHEN 'postal_code' THEN 'GeoPostalCode'
    WHEN 'street'      THEN 'GeoStreet'
    WHEN 'address'     THEN 'GeoAddress'
    ELSE NULL
  END;
  IF level_tag IS NULL THEN RETURN result; END IF;

  -- Peel legacy `$maybe` shorthand.
  was_maybe := false;
  inner_type := type_val;
  IF jsonb_typeof(inner_type) = 'object' AND (inner_type ? '$maybe') THEN
    was_maybe := true;
    inner_type := inner_type -> '$maybe';
  END IF;

  -- Verify the inner is a $tagged Id<country>.
  is_country_ref := false;
  IF jsonb_typeof(inner_type) = 'object' AND (inner_type ? '$tagged') THEN
    IF jsonb_typeof(inner_type -> '$tagged' -> 'value') = 'object'
       AND (inner_type -> '$tagged' -> 'value' ->> '$named') = 'Id'
       AND jsonb_typeof(inner_type -> '$tagged' -> 'phantom') = 'object'
       AND (inner_type -> '$tagged' -> 'phantom') ? '$refined'
       AND jsonb_typeof(inner_type -> '$tagged' -> 'phantom' -> '$refined' -> 'set') = 'object'
       AND (inner_type -> '$tagged' -> 'phantom' -> '$refined' -> 'set') ? '$enum'
    THEN
      -- Check first $enum member is "country".
      IF (inner_type -> '$tagged' -> 'phantom' -> '$refined' -> 'set' -> '$enum' ->> 0) = 'country'
      THEN
        is_country_ref := true;
      END IF;
    END IF;
  END IF;

  IF NOT is_country_ref THEN RETURN result; END IF;

  -- Build the Place wrap.
  new_inner := jsonb_build_object(
    '$tagged', jsonb_build_object(
      'value', jsonb_build_object('$named', 'GeoPath'),
      'phantom', jsonb_build_object(
        '$refined', jsonb_build_object(
          'base', jsonb_build_object('$named', 'GeoLevel'),
          'set', jsonb_build_object(
            '$enum', jsonb_build_array(jsonb_build_object('$tag', level_tag))
          )
        )
      )
    )
  );
  new_type := CASE
    WHEN was_maybe THEN jsonb_build_object('$maybe', new_inner)
    ELSE new_inner
  END;

  -- Strip refGeoResolution from meta; drop meta entirely if now empty.
  new_meta := meta - 'refGeoResolution';
  IF new_meta = '{}'::jsonb THEN
    result := (result || jsonb_build_object('type', new_type)) - 'meta';
  ELSE
    result := result || jsonb_build_object('type', new_type, 'meta', new_meta);
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries FieldDef-bearing
-- data. Column set mirrors the precedent set by 0047 / 0048.

UPDATE types
SET type = pg_temp.lift_field_refgeo(type),
    updated_at = NOW()
WHERE type::text LIKE '%"refGeoResolution"%';

UPDATE functions
SET function = pg_temp.lift_field_refgeo(function),
    updated_at = NOW()
WHERE function::text LIKE '%"refGeoResolution"%';

UPDATE function_instances
SET variables = pg_temp.lift_field_refgeo(variables)
WHERE variables::text LIKE '%"refGeoResolution"%';

UPDATE dispatch_registry
SET instance = pg_temp.lift_field_refgeo(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"refGeoResolution"%';

UPDATE views
SET view = pg_temp.lift_field_refgeo(view),
    updated_at = NOW()
WHERE view::text LIKE '%"refGeoResolution"%';

UPDATE locus_views
SET view = pg_temp.lift_field_refgeo(view),
    updated_at = NOW()
WHERE view::text LIKE '%"refGeoResolution"%';

UPDATE saved_queries
SET query = pg_temp.lift_field_refgeo(query),
    updated_at = NOW()
WHERE query::text LIKE '%"refGeoResolution"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_field_refgeo(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_field_refgeo(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"refGeoResolution"%'
   OR on_submit::text LIKE '%"refGeoResolution"%';

UPDATE registries
SET module = pg_temp.lift_field_refgeo(module),
    updated_at = NOW()
WHERE module::text LIKE '%"refGeoResolution"%';

COMMIT;
