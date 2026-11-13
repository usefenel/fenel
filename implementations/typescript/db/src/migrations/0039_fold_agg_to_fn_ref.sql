-- Rename `$fold.agg` magic strings to their Fenel-function counterparts.
-- The legacy FOLD_AGGREGATES table is gone in code; the `agg` field is now
-- a function-id/codeName reference dispatched through the regular function
-- registry. Most aggregate names (length, count, sum, avg) already match
-- their function counterparts. The three that don't:
--
--   min            → minimum       (std:minimum, list-aggregate)
--   max            → maximum       (std:maximum, list-aggregate)
--   distinct_count → distinctCount (std:distinctCount)
--
-- (`min` / `max` in std are *binary* arithmetic; the unary list-aggregate
-- versions are `minimum` / `maximum`, matching Haskell convention.)
--
-- We also update the `"value.<agg>"` JSON-Logic var paths used in $where
-- predicates that the SetExpr extractor lifts into $fold form.
--
-- Pattern targets the canonical JSONB form (`"agg":"X"`) — Postgres JSONB
-- normalises whitespace, so the literal substring is reliable. Each UPDATE
-- gates on a LIKE predicate for idempotency.

BEGIN;

-- Helper macro: rewrite $fold.agg and value.<agg> paths in a JSONB cell.
-- Each table calls this for every relevant column.

-- types: SetExpr lives in the type column (`$refined` types, $fold preds).
UPDATE types
SET type = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             type::text,
             '"agg":"min"',            '"agg":"minimum"'),
             '"agg":"max"',            '"agg":"maximum"'),
             '"agg":"distinct_count"', '"agg":"distinctCount"'),
             '"value.min"',            '"value.minimum"'),
             '"value.max"',            '"value.maximum"'),
             '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE type::text LIKE '%"agg":"min"%'
   OR type::text LIKE '%"agg":"max"%'
   OR type::text LIKE '%"agg":"distinct_count"%'
   OR type::text LIKE '%"value.min"%'
   OR type::text LIKE '%"value.max"%'
   OR type::text LIKE '%"value.distinct_count"%';

-- functions: signatures + bodies may carry refined types with $fold.
UPDATE functions
SET function = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 function::text,
                 '"agg":"min"',            '"agg":"minimum"'),
                 '"agg":"max"',            '"agg":"maximum"'),
                 '"agg":"distinct_count"', '"agg":"distinctCount"'),
                 '"value.min"',            '"value.minimum"'),
                 '"value.max"',            '"value.maximum"'),
                 '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE function::text LIKE '%"agg":"min"%'
   OR function::text LIKE '%"agg":"max"%'
   OR function::text LIKE '%"agg":"distinct_count"%'
   OR function::text LIKE '%"value.min"%'
   OR function::text LIKE '%"value.max"%'
   OR function::text LIKE '%"value.distinct_count"%';

-- function_instances: variables / trigger_event jsonb cells.
UPDATE function_instances
SET variables = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                  variables::text,
                  '"agg":"min"',            '"agg":"minimum"'),
                  '"agg":"max"',            '"agg":"maximum"'),
                  '"agg":"distinct_count"', '"agg":"distinctCount"'),
                  '"value.min"',            '"value.minimum"'),
                  '"value.max"',            '"value.maximum"'),
                  '"value.distinct_count"', '"value.distinctCount"')::jsonb
WHERE variables::text LIKE '%"agg":"min"%'
   OR variables::text LIKE '%"agg":"max"%'
   OR variables::text LIKE '%"agg":"distinct_count"%'
   OR variables::text LIKE '%"value.min"%'
   OR variables::text LIKE '%"value.max"%'
   OR variables::text LIKE '%"value.distinct_count"%';

-- typeclass_instances: method definitions may include refined types.
UPDATE typeclass_instances
SET instance = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 instance::text,
                 '"agg":"min"',            '"agg":"minimum"'),
                 '"agg":"max"',            '"agg":"maximum"'),
                 '"agg":"distinct_count"', '"agg":"distinctCount"'),
                 '"value.min"',            '"value.minimum"'),
                 '"value.max"',            '"value.maximum"'),
                 '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE instance::text LIKE '%"agg":"min"%'
   OR instance::text LIKE '%"agg":"max"%'
   OR instance::text LIKE '%"agg":"distinct_count"%'
   OR instance::text LIKE '%"value.min"%'
   OR instance::text LIKE '%"value.max"%'
   OR instance::text LIKE '%"value.distinct_count"%';

-- views / locus_views: view bodies may evaluate $fold predicates.
UPDATE views
SET view = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             view::text,
             '"agg":"min"',            '"agg":"minimum"'),
             '"agg":"max"',            '"agg":"maximum"'),
             '"agg":"distinct_count"', '"agg":"distinctCount"'),
             '"value.min"',            '"value.minimum"'),
             '"value.max"',            '"value.maximum"'),
             '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%"agg":"min"%'
   OR view::text LIKE '%"agg":"max"%'
   OR view::text LIKE '%"agg":"distinct_count"%'
   OR view::text LIKE '%"value.min"%'
   OR view::text LIKE '%"value.max"%'
   OR view::text LIKE '%"value.distinct_count"%';

UPDATE locus_views
SET view = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             view::text,
             '"agg":"min"',            '"agg":"minimum"'),
             '"agg":"max"',            '"agg":"maximum"'),
             '"agg":"distinct_count"', '"agg":"distinctCount"'),
             '"value.min"',            '"value.minimum"'),
             '"value.max"',            '"value.maximum"'),
             '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%"agg":"min"%'
   OR view::text LIKE '%"agg":"max"%'
   OR view::text LIKE '%"agg":"distinct_count"%'
   OR view::text LIKE '%"value.min"%'
   OR view::text LIKE '%"value.max"%'
   OR view::text LIKE '%"value.distinct_count"%';

-- saved_queries: query bodies.
UPDATE saved_queries
SET query = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              query::text,
              '"agg":"min"',            '"agg":"minimum"'),
              '"agg":"max"',            '"agg":"maximum"'),
              '"agg":"distinct_count"', '"agg":"distinctCount"'),
              '"value.min"',            '"value.minimum"'),
              '"value.max"',            '"value.maximum"'),
              '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE query::text LIKE '%"agg":"min"%'
   OR query::text LIKE '%"agg":"max"%'
   OR query::text LIKE '%"agg":"distinct_count"%'
   OR query::text LIKE '%"value.min"%'
   OR query::text LIKE '%"value.max"%'
   OR query::text LIKE '%"value.distinct_count"%';

-- form_definitions: field types may carry refinements with $fold.
UPDATE form_definitions
SET type   = CASE WHEN type IS NOT NULL THEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 type::text,
                 '"agg":"min"',            '"agg":"minimum"'),
                 '"agg":"max"',            '"agg":"maximum"'),
                 '"agg":"distinct_count"', '"agg":"distinctCount"'),
                 '"value.min"',            '"value.minimum"'),
                 '"value.max"',            '"value.maximum"'),
                 '"value.distinct_count"', '"value.distinctCount"')::jsonb ELSE type END
WHERE type::text LIKE '%"agg":"min"%'
   OR type::text LIKE '%"agg":"max"%'
   OR type::text LIKE '%"agg":"distinct_count"%'
   OR type::text LIKE '%"value.min"%'
   OR type::text LIKE '%"value.max"%'
   OR type::text LIKE '%"value.distinct_count"%';

-- registries: module body (jsonb) and source (text) may carry $fold preds.
UPDATE registries
SET module = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
               module::text,
               '"agg":"min"',            '"agg":"minimum"'),
               '"agg":"max"',            '"agg":"maximum"'),
               '"agg":"distinct_count"', '"agg":"distinctCount"'),
               '"value.min"',            '"value.minimum"'),
               '"value.max"',            '"value.maximum"'),
               '"value.distinct_count"', '"value.distinctCount"')::jsonb,
    updated_at = NOW()
WHERE module::text LIKE '%"agg":"min"%'
   OR module::text LIKE '%"agg":"max"%'
   OR module::text LIKE '%"agg":"distinct_count"%'
   OR module::text LIKE '%"value.min"%'
   OR module::text LIKE '%"value.max"%'
   OR module::text LIKE '%"value.distinct_count"%';

COMMIT;
