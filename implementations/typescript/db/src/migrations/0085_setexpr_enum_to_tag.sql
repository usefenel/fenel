-- set-algebra-to-fenel Phase 3b-2 Step 5 (the D-phase4-merge at-rest flip).
--
-- The 3b-2 producer flip moves the in-memory SetExpr representation from the
-- legacy `$`-key form to the canonical `$tag` `Se*` form (1:1 with the
-- registered `SetExpr` entity + `peelSetExpr`'s view). This migration flips the
-- AT-REST SetExpr data to match. Every reader dual-reads (3b-0/3b-1 + the codec
-- marshallers' `setExprToDollarKey` bridge), so this is safety-completing the
-- flip, not a hot-path necessity — but 3b-3 (the codec delete) needs zero
-- `$`-key SetExpr at rest.
--
-- THE FOOTPRINT (staging, measured 2026-06-22, re-confirmed authoritative):
-- the ONLY structural `$`-key SetExpr at rest is `$enum`, in two contexts:
--   (1) `Id<X>` phantoms — `$tagged.phantom.$refined.set.$enum` (= ["Bot"] /
--       ["country"] / … — ~13 in functions, ~181 in function_instances,
--       ~5 in entity_instances)
--   (2) `saved_queries` data-search filters — `filter.<field>.$enum` (~8 rows)
-- ZERO `$interval`/`$where`/`$union`/`$intersect`/`$diff`/`$complement`/`$all`/
-- `$none`/`$pattern` at rest (the `$all`/`$none`/`$union` text hits were
-- `.fenel`-source substrings in function bodies, NOT JSON keys). So this
-- migration handles `$enum` ONLY.
--
-- THE HAZARD (the single biggest at-rest correctness trap): the `$enum` sits
-- INSIDE a SetExpr slot (`$refined.set`, `$map.keys`, a data-search filter).
-- The surrounding FenelType envelope — `$tagged`, `$refined`, `$ref:"Id"`,
-- `$ref:"String"`, `$ref:"Bot"` — is the Ref substrate (typed-fn-refs 7g) and
-- MUST NOT flip. We disambiguate STRUCTURALLY, not by text:
--   * `$enum` is ALWAYS a SetExpr constructor — it is NEVER a FenelType key
--     (FenelType has no `$enum`). So any JSON OBJECT carrying an `$enum` KEY is
--     the SetExpr slot, full stop. The recursive walk rewrites `$enum` ONLY when
--     it is a real JSON key (never inside a string value — so a `.fenel`-source
--     string mentioning `$enum` is untouched), and leaves every `$ref` /
--     `$tagged` / `$refined` envelope key alone.
--
-- PATH-SCOPED, NOT a blind text REPLACE (the hazard demands it; modelled on the
-- recursive JSONB walk in 0061, NOT the stacked text-REPLACE in 0040): a
-- recursive plpgsql function rewrites every `{"$enum": [...]}` object to
-- `{"$tag":"SeEnum","values":[...]}`, recursing through arrays + all object
-- values so deeply-nested Id-phantom `$enum`s flip too.
--
-- Idempotent: a `{"$tag":"SeEnum",...}` object has no `$enum` key, so it is
-- left as-is; each UPDATE is gated on a `LIKE '%"$enum"%'` predicate.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_3b2_enum_to_tag(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  rest jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse over elements.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_3b2_enum_to_tag(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS a(elem));
  END IF;

  IF jsonb_typeof(j) = 'object' THEN
    -- A SetExpr `{"$enum": [...]}` → `{"$tag":"SeEnum","values":[...]}`.
    -- `$enum` as a JSON KEY is unambiguously the SetExpr enum constructor.
    IF j ? '$enum' THEN
      -- Preserve any sibling keys (a well-formed SetExpr enum is single-key, so
      -- this is `{}` in practice) — recursed for safety.
      rest := (SELECT COALESCE(jsonb_object_agg(k, pg_temp.lift_3b2_enum_to_tag(v)), '{}'::jsonb)
               FROM jsonb_each(j) AS e(k, v) WHERE k <> '$enum');
      RETURN jsonb_build_object(
               '$tag', 'SeEnum',
               'values', pg_temp.lift_3b2_enum_to_tag(j->'$enum')
             ) || rest;
    END IF;
    -- Otherwise recurse into every value (the Id-phantom `$enum` is 4 levels
    -- deep under `$tagged.phantom.$refined.set`).
    RETURN (SELECT COALESCE(jsonb_object_agg(k, pg_temp.lift_3b2_enum_to_tag(v)), '{}'::jsonb)
            FROM jsonb_each(j) AS e(k, v));
  END IF;

  -- Scalars (string / number / bool / null) — untouched. A `.fenel`-source
  -- string mentioning `$enum` is a scalar, never matched.
  RETURN j;
END;
$body$ LANGUAGE plpgsql;

-- The live SetExpr-bearing JSONB columns (0061's set minus the dropped
-- typeclass_instances / form_definitions tables). Each gated on the `$enum`
-- substring for idempotency; a column with no `$enum` is a no-op.

UPDATE types
SET type = pg_temp.lift_3b2_enum_to_tag(type), updated_at = NOW()
WHERE type::text LIKE '%"$enum"%';

UPDATE functions
SET function = pg_temp.lift_3b2_enum_to_tag(function), updated_at = NOW()
WHERE function::text LIKE '%"$enum"%';

UPDATE function_instances
SET variables = pg_temp.lift_3b2_enum_to_tag(variables)
WHERE variables::text LIKE '%"$enum"%';

UPDATE entity_instances
SET data = pg_temp.lift_3b2_enum_to_tag(data)
WHERE data::text LIKE '%"$enum"%';

UPDATE saved_queries
SET query = pg_temp.lift_3b2_enum_to_tag(query), updated_at = NOW()
WHERE query::text LIKE '%"$enum"%';

UPDATE views
SET view = pg_temp.lift_3b2_enum_to_tag(view), updated_at = NOW()
WHERE view::text LIKE '%"$enum"%';

UPDATE locus_views
SET view = pg_temp.lift_3b2_enum_to_tag(view), updated_at = NOW()
WHERE view::text LIKE '%"$enum"%';

UPDATE registries
SET module = pg_temp.lift_3b2_enum_to_tag(module), updated_at = NOW()
WHERE module::text LIKE '%"$enum"%';

COMMIT;
