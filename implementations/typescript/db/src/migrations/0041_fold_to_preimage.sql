-- Rename `$fold` SetExpr constructor to `$preimage`.
--
-- Background: the SetExpr's `$fold` constructor (`{$fold: {agg, set}}`)
-- means "values whose `agg(value)` is in `set`" — mathematically this
-- is the *preimage* of `set` under `agg`. The historical name `$fold`
-- collided confusingly with `std:fold` (the list-reduction Fenel
-- function), so we rename to the math-correct `$preimage` which
-- never collides.
--
-- The inner structure (`{agg: <fn-ref>, set: <subset>}`) is unchanged
-- — only the key changes. Migration 0039 already converted `agg`
-- magic strings to function references.
--
-- Pattern targets the canonical JSONB substring `"$fold":{` (key,
-- colon, object open — JSONB normalises whitespace). Each UPDATE
-- gates on a LIKE predicate for idempotency.

BEGIN;

UPDATE types
SET type = REPLACE(type::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE type::text LIKE '%"$fold":{%';

UPDATE functions
SET function = REPLACE(function::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE function::text LIKE '%"$fold":{%';

UPDATE function_instances
SET variables = REPLACE(variables::text, '"$fold":{', '"$preimage":{')::jsonb
WHERE variables::text LIKE '%"$fold":{%';

UPDATE typeclass_instances
SET instance = REPLACE(instance::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE instance::text LIKE '%"$fold":{%';

UPDATE views
SET view = REPLACE(view::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%"$fold":{%';

UPDATE locus_views
SET view = REPLACE(view::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%"$fold":{%';

UPDATE saved_queries
SET query = REPLACE(query::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE query::text LIKE '%"$fold":{%';

UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN REPLACE(type::text, '"$fold":{', '"$preimage":{')::jsonb ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN REPLACE(on_submit::text, '"$fold":{', '"$preimage":{')::jsonb ELSE on_submit END
WHERE type::text LIKE '%"$fold":{%'
   OR on_submit::text LIKE '%"$fold":{%';

UPDATE registries
SET module = REPLACE(module::text, '"$fold":{', '"$preimage":{')::jsonb,
    updated_at = NOW()
WHERE module::text LIKE '%"$fold":{%';

COMMIT;
