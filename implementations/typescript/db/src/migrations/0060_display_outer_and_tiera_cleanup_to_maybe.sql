-- Phase 7d of canonical-maybe — four Tier-A lifts in one walker:
--
--   1. `TypeView.display?: {read?, edit?}` → `Maybe<{read: Maybe<ReadDisplay>,
--      edit: Maybe<EditDisplay>}>` — outer-over-inner wrap that closes the
--      display arc. Inner `read` / `edit` slots also lifted to Maybe.
--
--   2. `ResolutionLevel.step?: [number, number]` → `Maybe<[number, number]>`.
--      Detected by parent-key context (`levels:` or `resolution:` parent).
--
--   3. `Scope.accountId?: string` → `Maybe<string>`. Detected by parent-key
--      context (`scope:` parent). Nothing = system/std row visible
--      platform-wide; Just(uuid) = account-owned.
--
--   4. `OnSubmitAction.CreatePaymentLink.stepSlug?: string` → `Maybe<string>`.
--      Detected by `{$tag: "CreatePaymentLink"}` discriminator on any object;
--      lifts `stepSlug` per-slot.
--
-- Idempotency: every lift helper checks for `$tag`-presence (already
-- canonical Maybe) and short-circuits. Safe to re-run.
--
-- Display outer-rule guard: a `display:` key alone is not enough — many
-- non-TypeView shapes might carry a `display:` key (e.g., CSS-style
-- metadata). The walker only lifts when the value contains EITHER a
-- `read:` key OR an `edit:` key (structurally a TypeView display payload).
--
-- Scope is a 1-field type; detection by "only accountId key" is fragile
-- post-lift. The walker uses parent-key context (`scope:` parent) to gate
-- the lift cleanly.
--
-- Phase 7d closes the Tier-A arc across types.ts: after this migration,
-- the only remaining `?:` slots are Tier B (`FieldDef.meta?`,
-- `Trace.meta?`) and Tier C (`CaseDef.fields?`).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_p7d_one(slot_val jsonb)
RETURNS jsonb AS $body$
BEGIN
  IF slot_val IS NULL THEN
    RETURN jsonb_build_object('$tag', 'Nothing');
  ELSIF jsonb_typeof(slot_val) = 'object' AND (slot_val ? '$tag') THEN
    RETURN slot_val;
  ELSE
    RETURN jsonb_build_object('$tag', 'Just', 'value', slot_val);
  END IF;
END;
$body$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.lift_p7d_walk(j jsonb, parent_key text)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  disp_val jsonb;
  is_create_payment_link boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse with the array's parent_key for elements (so
  -- `levels: [{...}, {...}]` propagates `levels` to each element).
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_p7d_walk(elem, parent_key)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Recurse into all values first.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_p7d_walk(x.v, x.k)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- (1) Outer display lift — guard by `read:` or `edit:` sub-key presence.
  IF result ? 'display' THEN
    disp_val := result -> 'display';
    IF disp_val IS NULL OR jsonb_typeof(disp_val) = 'null' THEN
      result := result || jsonb_build_object('display', jsonb_build_object('$tag', 'Nothing'));
    ELSIF jsonb_typeof(disp_val) = 'object' AND (disp_val ? '$tag') THEN
      -- already canonical
      NULL;
    ELSIF jsonb_typeof(disp_val) = 'object' AND ((disp_val ? 'read') OR (disp_val ? 'edit')) THEN
      result := result || jsonb_build_object(
        'display',
        jsonb_build_object(
          '$tag', 'Just',
          'value', jsonb_build_object(
            'read', pg_temp.lift_p7d_one(disp_val -> 'read'),
            'edit', pg_temp.lift_p7d_one(disp_val -> 'edit')
          )
        )
      );
    END IF;
  END IF;

  -- (2) ResolutionLevel.step — parent-key context `levels` or `resolution`.
  IF parent_key IN ('levels', 'resolution') AND (result ? 'name') THEN
    result := result || jsonb_build_object('step', pg_temp.lift_p7d_one(result -> 'step'));
  END IF;

  -- (3) Scope.accountId — parent-key context `scope`.
  IF parent_key = 'scope' THEN
    result := result || jsonb_build_object('accountId', pg_temp.lift_p7d_one(result -> 'accountId'));
  END IF;

  -- (4) OnSubmitAction.CreatePaymentLink.stepSlug — by $tag discriminator.
  is_create_payment_link := (result -> '$tag') = '"CreatePaymentLink"'::jsonb;
  IF is_create_payment_link THEN
    result := result || jsonb_build_object('stepSlug', pg_temp.lift_p7d_one(result -> 'stepSlug'));
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.lift_p7d(j jsonb)
RETURNS jsonb AS $body$
BEGIN
  RETURN pg_temp.lift_p7d_walk(j, NULL);
END;
$body$ LANGUAGE plpgsql;

-- Apply to every JSONB column that historically carries TypeView /
-- ResolutionLevel / Scope / OnSubmitAction payloads. Column set
-- mirrors 0054–0059.

UPDATE types
SET type = pg_temp.lift_p7d(type),
    updated_at = NOW()
WHERE type::text LIKE '%"display":%'
   OR type::text LIKE '%"step":%'
   OR type::text LIKE '%"scope":%'
   OR type::text LIKE '%"CreatePaymentLink"%';

UPDATE functions
SET function = pg_temp.lift_p7d(function),
    updated_at = NOW()
WHERE function::text LIKE '%"display":%'
   OR function::text LIKE '%"step":%'
   OR function::text LIKE '%"scope":%'
   OR function::text LIKE '%"CreatePaymentLink"%';

UPDATE function_instances
SET variables = pg_temp.lift_p7d(variables)
WHERE variables::text LIKE '%"display":%'
   OR variables::text LIKE '%"step":%'
   OR variables::text LIKE '%"scope":%'
   OR variables::text LIKE '%"CreatePaymentLink"%';

UPDATE typeclass_instances
SET instance = pg_temp.lift_p7d(instance),
    updated_at = NOW()
WHERE instance::text LIKE '%"display":%'
   OR instance::text LIKE '%"step":%'
   OR instance::text LIKE '%"scope":%'
   OR instance::text LIKE '%"CreatePaymentLink"%';

UPDATE views
SET view = pg_temp.lift_p7d(view),
    updated_at = NOW()
WHERE view::text LIKE '%"display":%'
   OR view::text LIKE '%"step":%'
   OR view::text LIKE '%"scope":%'
   OR view::text LIKE '%"CreatePaymentLink"%';

UPDATE locus_views
SET view = pg_temp.lift_p7d(view),
    updated_at = NOW()
WHERE view::text LIKE '%"display":%'
   OR view::text LIKE '%"step":%'
   OR view::text LIKE '%"scope":%'
   OR view::text LIKE '%"CreatePaymentLink"%';

UPDATE saved_queries
SET query = pg_temp.lift_p7d(query),
    updated_at = NOW()
WHERE query::text LIKE '%"display":%'
   OR query::text LIKE '%"step":%'
   OR query::text LIKE '%"scope":%'
   OR query::text LIKE '%"CreatePaymentLink"%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN pg_temp.lift_p7d(type) ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN pg_temp.lift_p7d(on_submit) ELSE on_submit END
WHERE type::text LIKE '%"display":%'
   OR type::text LIKE '%"step":%'
   OR type::text LIKE '%"scope":%'
   OR type::text LIKE '%"CreatePaymentLink"%'
   OR on_submit::text LIKE '%"display":%'
   OR on_submit::text LIKE '%"step":%'
   OR on_submit::text LIKE '%"scope":%'
   OR on_submit::text LIKE '%"CreatePaymentLink"%';

UPDATE registries
SET module = pg_temp.lift_p7d(module),
    updated_at = NOW()
WHERE module::text LIKE '%"display":%'
   OR module::text LIKE '%"step":%'
   OR module::text LIKE '%"scope":%'
   OR module::text LIKE '%"CreatePaymentLink"%';

COMMIT;
