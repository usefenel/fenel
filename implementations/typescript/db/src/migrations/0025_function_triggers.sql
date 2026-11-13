-- Phase B of the function-storage cleanup: separate trigger bindings from
-- the function spec. A FenelFunction value is the function (params,
-- returns, body); triggers are a *registration* concern — many-to-one
-- bindings that say "when event X fires, invoke function f".
--
-- Migration:
--   1. Create function_triggers table.
--   2. For each functions row whose JSONB has a `trigger` key, create one
--      function_triggers row carrying the trigger spec, cancelWhen
--      predicate, and (preserved separately) args mapping. Use the
--      function's id as the FK target.
--   3. Strip `trigger`, `cancelWhen`, `args`, `version`, `active` from the
--      `function` JSONB. (`version` and `active` already live as columns
--      on the functions table; `trigger`/`cancelWhen` move to the new
--      table; `args` was the legacy raw shape that the migration in 0024
--      transformed into `params` already, so its absence is correct.)
--      The remaining JSONB is the pure FenelFunction spec.

-- 1. Create the table.
CREATE TABLE function_triggers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES accounts(id),
  function_id UUID        NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  trigger     JSONB       NOT NULL,
  cancel_when JSONB,
  args        JSONB,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX function_triggers_account_function_idx
  ON function_triggers (account_id, function_id);

CREATE INDEX function_triggers_account_active_idx
  ON function_triggers (account_id, active);

-- 2. Migrate trigger data out of the function JSONB into rows.
INSERT INTO function_triggers (account_id, function_id, trigger, cancel_when, active, created_at)
SELECT
  f.account_id,
  f.id AS function_id,
  f.function->'trigger' AS trigger,
  f.function->'cancelWhen' AS cancel_when,
  f.active,
  f.created_at
FROM functions f
WHERE f.function ? 'trigger' AND jsonb_typeof(f.function->'trigger') = 'object';

-- 3. Strip trigger / cancelWhen / args / version / active keys from the
--    function JSONB so it represents the pure FenelFunction spec.
UPDATE functions
SET function = (function - 'trigger' - 'cancelWhen' - 'args' - 'version' - 'active');
