-- 0046: Phase 13b sub-step 4 — flip form_definitions.on_submit rules
-- from persisted `{action, params}` shape to FormOnSubmitAction ADT
-- shape `{$tag, ...flatFields}`. Idempotent: skips rules already in
-- ADT shape (presence of `$tag` key) AND leaves unknown shapes
-- unchanged (ELSE branch).
--
-- At time of writing, the only non-empty `on_submit` row in dev/staging
-- uses a hand-authored DSL shape that pre-dates the current TS-type
-- contract entirely (`{then: {create_payment_link: {...}}}` instead of
-- `{then: {action: "create_payment_link", params: {...}}}`). That row
-- doesn't validate against the pre-migration shape either, so the
-- migration's ELSE branch leaves it as-is — no regression. Future
-- consumers must either re-author the row to the ADT shape or expand
-- this migration's CASE arms.

UPDATE form_definitions
SET on_submit = (
  SELECT jsonb_agg(
    CASE
      -- Idempotent — already migrated rows skip unchanged.
      WHEN rule->'then' ? '$tag' THEN rule
      WHEN rule->'then'->>'action' = 'create_payment_link' THEN
        jsonb_set(rule, '{then}', jsonb_build_object(
          '$tag', 'CreatePaymentLink',
          'planSlug', rule->'then'->'params'->'planSlug',
          'stepSlug', rule->'then'->'params'->'stepSlug'
        ))
      WHEN rule->'then'->>'action' = 'show_page' THEN
        jsonb_set(rule, '{then}', jsonb_build_object(
          '$tag', 'ShowPage',
          'page', rule->'then'->'params'->'page'
        ))
      WHEN rule->'then'->>'action' = 'redirect' THEN
        jsonb_set(rule, '{then}', jsonb_build_object(
          '$tag', 'Redirect',
          'url', rule->'then'->'params'->'url'
        ))
      WHEN rule->'then'->>'action' = 'set_value' THEN
        jsonb_set(rule, '{then}', jsonb_build_object(
          '$tag', 'SetValue',
          'target', rule->'then'->'params'->'target',
          'value', COALESCE(rule->'then'->'params'->'value', '""'::jsonb)
        ))
      -- Unknown shape — leave the rule as-is. The wrapper's matchedAction
      -- selection iterates rules until one matches; unrecognised shapes
      -- pass through unchanged and produce a `{$tag: "Nothing"}` matched
      -- action downstream (no action overlay applied to the response).
      ELSE rule
    END
  )
  FROM jsonb_array_elements(on_submit) AS rule
)
WHERE on_submit IS NOT NULL
  AND jsonb_array_length(on_submit) > 0;
