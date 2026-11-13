-- Rewrite stored JSON-Logic operator-form ASTs (`{"+": [a, b]}`) to the
-- canonical call form (`{"add": [a, b]}` — key-as-fnId).
--
-- Background: operators are Fenel functions in the unified-dispatch
-- world. The evaluator's case branches for `+ - * / % == != < <= > >=
-- cat` are gone; calls flow through the function-registry dispatch
-- path via the universal `{key: [args]}` shape. Legacy stored data
-- using the JSON-Logic operator-form gets rewritten to the function
-- codeName here so it dispatches correctly post-overhaul.
--
-- Operator → codeName mapping (matches `INFIX_NOTATION_TO_CODENAME`
-- in fenel-parser and `INFIXABLE_BY_NAME` in fenel-printer):
--
--   +   → add        ==  → eq
--   -   → sub        !=  → neq
--   *   → mul        <   → lt
--   /   → div        <=  → lte
--   %   → mod        >   → gt
--   cat → concat     >=  → gte
--
-- (`and` / `or` stay as JSON-Logic ops — they're short-circuit
-- structural forms, not strict functions. `if` similarly stays as a
-- structural form.)
--
-- Pattern targets the canonical JSONB substring `"<op>":[` (operator
-- name, colon, array open — JSONB normalises whitespace). Each UPDATE
-- gates on a LIKE predicate for idempotency.

BEGIN;

-- Helper macro to rewrite all operator-form keys in one JSONB cell.
-- Done as a stacked REPLACE; each operator string is distinct enough
-- that false positives are unlikely (the substring `"+":[` doesn't
-- show up in normal field-name contexts).

-- types: SetExpr lives in the type column ($refined types, $where preds).
UPDATE types
SET type = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             type::text,
             '"+":[',  '"add":['),
             '"-":[',  '"sub":['),
             '"*":[',  '"mul":['),
             '"/":[',  '"div":['),
             '"%":[',  '"mod":['),
             '"==":[', '"eq":['),
             '"!=":[', '"neq":['),
             '"<=":[', '"lte":['),
             '">=":[', '"gte":['),
             '"<":[',  '"lt":['),
             '">":[',  '"gt":['),
             '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE type::text LIKE '%"+":[%'  OR type::text LIKE '%"-":[%'  OR type::text LIKE '%"*":[%'
   OR type::text LIKE '%"/":[%'  OR type::text LIKE '%"%":[%'
   OR type::text LIKE '%"==":[%' OR type::text LIKE '%"!=":[%'
   OR type::text LIKE '%"<=":[%' OR type::text LIKE '%">=":[%'
   OR type::text LIKE '%"<":[%'  OR type::text LIKE '%">":[%'
   OR type::text LIKE '%"cat":[%';

-- functions: bodies + signatures.
UPDATE functions
SET function = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 function::text,
                 '"+":[',  '"add":['),
                 '"-":[',  '"sub":['),
                 '"*":[',  '"mul":['),
                 '"/":[',  '"div":['),
                 '"%":[',  '"mod":['),
                 '"==":[', '"eq":['),
                 '"!=":[', '"neq":['),
                 '"<=":[', '"lte":['),
                 '">=":[', '"gte":['),
                 '"<":[',  '"lt":['),
                 '">":[',  '"gt":['),
                 '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE function::text LIKE '%"+":[%'  OR function::text LIKE '%"-":[%'  OR function::text LIKE '%"*":[%'
   OR function::text LIKE '%"/":[%'  OR function::text LIKE '%"%":[%'
   OR function::text LIKE '%"==":[%' OR function::text LIKE '%"!=":[%'
   OR function::text LIKE '%"<=":[%' OR function::text LIKE '%">=":[%'
   OR function::text LIKE '%"<":[%'  OR function::text LIKE '%">":[%'
   OR function::text LIKE '%"cat":[%';

-- function_instances: variables (jsonb).
UPDATE function_instances
SET variables = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                  variables::text,
                  '"+":[',  '"add":['),
                  '"-":[',  '"sub":['),
                  '"*":[',  '"mul":['),
                  '"/":[',  '"div":['),
                  '"%":[',  '"mod":['),
                  '"==":[', '"eq":['),
                  '"!=":[', '"neq":['),
                  '"<=":[', '"lte":['),
                  '">=":[', '"gte":['),
                  '"<":[',  '"lt":['),
                  '">":[',  '"gt":['),
                  '"cat":[','"concat":[')::jsonb
WHERE variables::text LIKE '%"+":[%'  OR variables::text LIKE '%"-":[%'  OR variables::text LIKE '%"*":[%'
   OR variables::text LIKE '%"/":[%'  OR variables::text LIKE '%"%":[%'
   OR variables::text LIKE '%"==":[%' OR variables::text LIKE '%"!=":[%'
   OR variables::text LIKE '%"<=":[%' OR variables::text LIKE '%">=":[%'
   OR variables::text LIKE '%"<":[%'  OR variables::text LIKE '%">":[%'
   OR variables::text LIKE '%"cat":[%';

-- typeclass_instances: method definitions may include refined types
-- with $where predicates that use operator-form JSON Logic.
UPDATE typeclass_instances
SET instance = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                 instance::text,
                 '"+":[',  '"add":['),
                 '"-":[',  '"sub":['),
                 '"*":[',  '"mul":['),
                 '"/":[',  '"div":['),
                 '"%":[',  '"mod":['),
                 '"==":[', '"eq":['),
                 '"!=":[', '"neq":['),
                 '"<=":[', '"lte":['),
                 '">=":[', '"gte":['),
                 '"<":[',  '"lt":['),
                 '">":[',  '"gt":['),
                 '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE instance::text LIKE '%"+":[%'  OR instance::text LIKE '%"-":[%'  OR instance::text LIKE '%"*":[%'
   OR instance::text LIKE '%"/":[%'  OR instance::text LIKE '%"%":[%'
   OR instance::text LIKE '%"==":[%' OR instance::text LIKE '%"!=":[%'
   OR instance::text LIKE '%"<=":[%' OR instance::text LIKE '%">=":[%'
   OR instance::text LIKE '%"<":[%'  OR instance::text LIKE '%">":[%'
   OR instance::text LIKE '%"cat":[%';

-- views / locus_views: view bodies often have $where with operator forms.
UPDATE views
SET view = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             view::text,
             '"+":[',  '"add":['),
             '"-":[',  '"sub":['),
             '"*":[',  '"mul":['),
             '"/":[',  '"div":['),
             '"%":[',  '"mod":['),
             '"==":[', '"eq":['),
             '"!=":[', '"neq":['),
             '"<=":[', '"lte":['),
             '">=":[', '"gte":['),
             '"<":[',  '"lt":['),
             '">":[',  '"gt":['),
             '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%"+":[%'  OR view::text LIKE '%"-":[%'  OR view::text LIKE '%"*":[%'
   OR view::text LIKE '%"/":[%'  OR view::text LIKE '%"%":[%'
   OR view::text LIKE '%"==":[%' OR view::text LIKE '%"!=":[%'
   OR view::text LIKE '%"<=":[%' OR view::text LIKE '%">=":[%'
   OR view::text LIKE '%"<":[%'  OR view::text LIKE '%">":[%'
   OR view::text LIKE '%"cat":[%';

UPDATE locus_views
SET view = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             view::text,
             '"+":[',  '"add":['),
             '"-":[',  '"sub":['),
             '"*":[',  '"mul":['),
             '"/":[',  '"div":['),
             '"%":[',  '"mod":['),
             '"==":[', '"eq":['),
             '"!=":[', '"neq":['),
             '"<=":[', '"lte":['),
             '">=":[', '"gte":['),
             '"<":[',  '"lt":['),
             '">":[',  '"gt":['),
             '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE view::text LIKE '%"+":[%'  OR view::text LIKE '%"-":[%'  OR view::text LIKE '%"*":[%'
   OR view::text LIKE '%"/":[%'  OR view::text LIKE '%"%":[%'
   OR view::text LIKE '%"==":[%' OR view::text LIKE '%"!=":[%'
   OR view::text LIKE '%"<=":[%' OR view::text LIKE '%">=":[%'
   OR view::text LIKE '%"<":[%'  OR view::text LIKE '%">":[%'
   OR view::text LIKE '%"cat":[%';

-- saved_queries.
UPDATE saved_queries
SET query = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              query::text,
              '"+":[',  '"add":['),
              '"-":[',  '"sub":['),
              '"*":[',  '"mul":['),
              '"/":[',  '"div":['),
              '"%":[',  '"mod":['),
              '"==":[', '"eq":['),
              '"!=":[', '"neq":['),
              '"<=":[', '"lte":['),
              '">=":[', '"gte":['),
              '"<":[',  '"lt":['),
              '">":[',  '"gt":['),
              '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE query::text LIKE '%"+":[%'  OR query::text LIKE '%"-":[%'  OR query::text LIKE '%"*":[%'
   OR query::text LIKE '%"/":[%'  OR query::text LIKE '%"%":[%'
   OR query::text LIKE '%"==":[%' OR query::text LIKE '%"!=":[%'
   OR query::text LIKE '%"<=":[%' OR query::text LIKE '%">=":[%'
   OR query::text LIKE '%"<":[%'  OR query::text LIKE '%">":[%'
   OR query::text LIKE '%"cat":[%';

-- form_definitions: field types + on_submit may carry operator-form
-- ASTs.
UPDATE form_definitions
SET type      = CASE WHEN type IS NOT NULL THEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                  type::text,
                  '"+":[',  '"add":['),
                  '"-":[',  '"sub":['),
                  '"*":[',  '"mul":['),
                  '"/":[',  '"div":['),
                  '"%":[',  '"mod":['),
                  '"==":[', '"eq":['),
                  '"!=":[', '"neq":['),
                  '"<=":[', '"lte":['),
                  '">=":[', '"gte":['),
                  '"<":[',  '"lt":['),
                  '">":[',  '"gt":['),
                  '"cat":[','"concat":[')::jsonb ELSE type END,
    on_submit = CASE WHEN on_submit IS NOT NULL THEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                  on_submit::text,
                  '"+":[',  '"add":['),
                  '"-":[',  '"sub":['),
                  '"*":[',  '"mul":['),
                  '"/":[',  '"div":['),
                  '"%":[',  '"mod":['),
                  '"==":[', '"eq":['),
                  '"!=":[', '"neq":['),
                  '"<=":[', '"lte":['),
                  '">=":[', '"gte":['),
                  '"<":[',  '"lt":['),
                  '">":[',  '"gt":['),
                  '"cat":[','"concat":[')::jsonb ELSE on_submit END
WHERE type::text LIKE '%"+":[%'  OR type::text LIKE '%"-":[%'  OR type::text LIKE '%"*":[%'
   OR type::text LIKE '%"/":[%'  OR type::text LIKE '%"%":[%'
   OR type::text LIKE '%"==":[%' OR type::text LIKE '%"!=":[%'
   OR type::text LIKE '%"<=":[%' OR type::text LIKE '%">=":[%'
   OR type::text LIKE '%"<":[%'  OR type::text LIKE '%">":[%'
   OR type::text LIKE '%"cat":[%'
   OR on_submit::text LIKE '%"+":[%'  OR on_submit::text LIKE '%"-":[%'  OR on_submit::text LIKE '%"*":[%'
   OR on_submit::text LIKE '%"/":[%'  OR on_submit::text LIKE '%"%":[%'
   OR on_submit::text LIKE '%"==":[%' OR on_submit::text LIKE '%"!=":[%'
   OR on_submit::text LIKE '%"<=":[%' OR on_submit::text LIKE '%">=":[%'
   OR on_submit::text LIKE '%"<":[%'  OR on_submit::text LIKE '%">":[%'
   OR on_submit::text LIKE '%"cat":[%';

-- registries: module / source contain parsed bodies and the .fenel
-- source text — both can carry operator-form ASTs.
UPDATE registries
SET module = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
               module::text,
               '"+":[',  '"add":['),
               '"-":[',  '"sub":['),
               '"*":[',  '"mul":['),
               '"/":[',  '"div":['),
               '"%":[',  '"mod":['),
               '"==":[', '"eq":['),
               '"!=":[', '"neq":['),
               '"<=":[', '"lte":['),
               '">=":[', '"gte":['),
               '"<":[',  '"lt":['),
               '">":[',  '"gt":['),
               '"cat":[','"concat":[')::jsonb,
    updated_at = NOW()
WHERE module::text LIKE '%"+":[%'  OR module::text LIKE '%"-":[%'  OR module::text LIKE '%"*":[%'
   OR module::text LIKE '%"/":[%'  OR module::text LIKE '%"%":[%'
   OR module::text LIKE '%"==":[%' OR module::text LIKE '%"!=":[%'
   OR module::text LIKE '%"<=":[%' OR module::text LIKE '%">=":[%'
   OR module::text LIKE '%"<":[%'  OR module::text LIKE '%">":[%'
   OR module::text LIKE '%"cat":[%';

COMMIT;
