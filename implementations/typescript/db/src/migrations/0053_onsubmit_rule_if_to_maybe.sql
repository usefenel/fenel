-- Phase 2 of canonical-maybe — lift `OnSubmitRule.if?` to canonical
-- `Maybe<Expression>`. The TS declaration in `types.ts:849-852` no longer
-- carries `?:`; every persisted rule must have an `if` slot whose value
-- is either `{$tag: "Nothing"}` (unconditional, was absent) or
-- `{$tag: "Just", value: <expr>}` (conditional, was the raw Expression).
--
-- Why this works: the consumer at `core/src/actions/forms.ts:241` now
-- discriminates on `$tag` instead of testing `rule.if` for truthiness.
-- An absent `if` field on the persisted shape would deserialize to
-- `undefined` and crash the `.$tag` access; pre-lifting at migration
-- time avoids a normalize-on-read code path.
--
-- Lift rule:
--
--   {                                            {
--     "then": <action>                             "then": <action>,
--   }                                              "if":   {"$tag": "Nothing"}
--                                                }
--
--   {                                            {
--     "if":   <expr>,                              "if":   {"$tag": "Just",
--     "then": <action>                                       "value": <expr>},
--   }                                              "then": <action>
--                                                }
--
-- Idempotency: skip when `if` is already a JSONB object with key `$tag`
-- (the wrapped form). Mirrors the collision-skip rule from migrations
-- 0051 / 0052.
--
-- Scope: OnSubmitRule values live ONLY in `form_definitions.on_submit`
-- (the column is a JSONB array of OnSubmitRule objects). No other JSONB
-- column carries the shape. The 9-column sweep from 0051/0052 is
-- unnecessary — this migration touches one column.
--
-- Detection: an OnSubmitRule-shaped object is identified by having a
-- `then` key whose value is a JSONB object (the OnSubmitAction
-- discriminator, e.g. `{"$tag": "CreatePaymentLink", "planSlug": ...}`).
-- The walker recurses into the on_submit JSONB array; each top-level
-- element is an OnSubmitRule. The walker is also defensive against
-- nesting (e.g. a future shape where rules nest) by recursing into all
-- object values.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lift_onsubmit_rule_if(j jsonb)
RETURNS jsonb AS $body$
DECLARE
  result jsonb;
  then_val jsonb;
  if_val jsonb;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;

  -- Arrays — recurse each element.
  IF jsonb_typeof(j) = 'array' THEN
    RETURN (SELECT COALESCE(jsonb_agg(pg_temp.lift_onsubmit_rule_if(elem)), '[]'::jsonb)
            FROM jsonb_array_elements(j) AS elem);
  END IF;

  -- Leaves — pass through.
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;

  -- Objects — recurse into all values first so nested OnSubmitRules lift too.
  result := (SELECT COALESCE(jsonb_object_agg(x.k, pg_temp.lift_onsubmit_rule_if(x.v)), '{}'::jsonb)
             FROM jsonb_each(j) AS x(k, v));

  -- Is THIS object an OnSubmitRule? Detection: has `then` key whose value
  -- is a JSONB object (the OnSubmitAction shape).
  then_val := result -> 'then';
  IF then_val IS NULL OR jsonb_typeof(then_val) <> 'object' THEN
    RETURN result;
  END IF;

  if_val := result -> 'if';

  -- Idempotency: skip if already lifted (existing `if` is an object with `$tag`).
  IF if_val IS NOT NULL AND jsonb_typeof(if_val) = 'object' AND (if_val ? '$tag') THEN
    RETURN result;
  END IF;

  -- Lift.
  IF if_val IS NULL THEN
    result := result || jsonb_build_object('if', jsonb_build_object('$tag', 'Nothing'));
  ELSE
    result := result || jsonb_build_object(
      'if', jsonb_build_object('$tag', 'Just', 'value', if_val)
    );
  END IF;

  RETURN result;
END;
$body$ LANGUAGE plpgsql;

-- Apply only to `form_definitions.on_submit`. OnSubmitRule is not stored
-- anywhere else.

UPDATE form_definitions
SET on_submit = pg_temp.lift_onsubmit_rule_if(on_submit)
WHERE on_submit IS NOT NULL;

COMMIT;
