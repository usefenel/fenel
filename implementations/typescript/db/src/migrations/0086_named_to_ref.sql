-- typed-function-references 7g-retire-final (the at-rest half of the `{$named}`
-- elimination). The Ref substrate (7g-retire-4c) made `{$ref}` the sole
-- name-handle in BOTH the FenelType and SetExpr unions in-memory; the producers
-- (runtime marshal sites + the parser + type-foundation) already emit `{$ref}`.
-- This migration flips the AT-REST data to match, so the read-tolerance leaves
-- (`refHandle`'s `$named` branch, `SET_EXPR_KEYS`, the marshal `$named` arms) and
-- the `bridgeNamedToRef` load-path shim can be DELETED (Stage 3) without breaking
-- any persisted row.
--
-- THE FOOTPRINT (staging, measured 2026-06-26 — `to_jsonb(tbl.*)::text LIKE
-- '%"$named"%'`): function_instances 225, functions 24, entity_instances 17,
-- types 1 (= 267 rows). ZERO in saved_queries / views / locus_views / registries
-- (covered anyway, guarded — a no-op there).
--
-- THE DISAMBIGUATION (mirrors 0085's `$enum`-is-always-SetExpr argument): a
-- `$named` JSON KEY is UNAMBIGUOUSLY a name-handle — a FenelType ref
-- (`{$named:"List"}`) OR a SetExpr ref (`{$named:"email"}`); BOTH flip to
-- `{$ref}` (`refHandle`/`peelSetExpr` read `{$ref}` identically in either
-- position — for a SetExpr ref, `peelSetExpr` yields `kind:"SeRef"`, the same as
-- 0085 left at-rest ref-SetExprs in `$`-key form: only `$enum` was lifted to the
-- `$tag` form, refs stayed `$`-key). There is NO other meaning of a `$named` JSON
-- key in Fenel data — so any OBJECT carrying a `$named` KEY flips, and a string
-- VALUE mentioning `$named` (a `.fenel`-source substring) is never matched.
--
-- PATH-SCOPED recursive JSONB walk (modelled on 0085 / 0061), NOT a blind text
-- REPLACE: rewrite every `{"$named": H}` object to `{"$ref": H}`, recursing
-- through arrays + all object values so deeply-nested Id-phantom refs
-- (`$tagged.value`, `$refined.base`) flip too. The `$ref` / `$tagged` / `$refined`
-- envelope keys are left alone (only the `$named` key is rewritten).
--
-- Idempotent: a `{"$ref":...}` object has no `$named` key ⇒ left as-is; each
-- UPDATE is gated on `LIKE '%"$named"%'`.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_named_to_ref(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  rest jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse over elements.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_named_to_ref(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS a(elem));
  END IF;

  IF jsonb_typeof(j) = 'object' THEN
    -- A name-handle `{"$named": H}` → `{"$ref": H}`. `$named` as a JSON KEY is
    -- unambiguously a name-handle (FenelType OR SetExpr ref).
    IF j ? '$named' THEN
      -- Preserve any sibling keys (a well-formed name-ref is single-key, so this
      -- is `{}` in practice) — recursed for safety.
      rest := (SELECT COALESCE(jsonb_object_agg(k, pg_temp.lift_named_to_ref(v)), '{}'::jsonb)
               FROM jsonb_each(j) AS e(k, v) WHERE k <> '$named');
      RETURN jsonb_build_object('$ref', pg_temp.lift_named_to_ref(j->'$named')) || rest;
    END IF;
    -- Otherwise recurse into every value (a ref can sit deep under
    -- `$tagged.value` / `$refined.base` / a record field / a `$refined.set`).
    RETURN (SELECT COALESCE(jsonb_object_agg(k, pg_temp.lift_named_to_ref(v)), '{}'::jsonb)
            FROM jsonb_each(j) AS e(k, v));
  END IF;

  -- Scalars — untouched. A string mentioning `$named` is a scalar, never matched.
  RETURN j;
END;
$body$ LANGUAGE plpgsql;

-- The live FenelType/SetExpr-bearing JSONB columns (the 0085 set). Each gated on
-- the `$named` substring for idempotency; a column with no `$named` is a no-op.

UPDATE types
SET type = pg_temp.lift_named_to_ref(type), updated_at = NOW()
WHERE type::text LIKE '%"$named"%';

UPDATE functions
SET function = pg_temp.lift_named_to_ref(function), updated_at = NOW()
WHERE function::text LIKE '%"$named"%';

UPDATE function_instances
SET variables = pg_temp.lift_named_to_ref(variables)
WHERE variables::text LIKE '%"$named"%';

UPDATE entity_instances
SET data = pg_temp.lift_named_to_ref(data)
WHERE data::text LIKE '%"$named"%';

UPDATE saved_queries
SET query = pg_temp.lift_named_to_ref(query), updated_at = NOW()
WHERE query::text LIKE '%"$named"%';

UPDATE views
SET view = pg_temp.lift_named_to_ref(view), updated_at = NOW()
WHERE view::text LIKE '%"$named"%';

UPDATE locus_views
SET view = pg_temp.lift_named_to_ref(view), updated_at = NOW()
WHERE view::text LIKE '%"$named"%';

UPDATE registries
SET module = pg_temp.lift_named_to_ref(module), updated_at = NOW()
WHERE module::text LIKE '%"$named"%';

COMMIT;
