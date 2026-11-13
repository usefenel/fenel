-- Unify the two function storages into one.
--
-- Before: two tables, both holding FenelFunction-shaped data.
--   `functions`             — user-defined library functions (keyed by name)
--   `function_definitions`  — durable trigger-bearing functions (keyed by id+slug+version)
--
-- After: one `functions` table holding ALL functions. Trigger metadata is
-- optional inside the FenelFunction JSONB. Library functions are simply
-- functions without a trigger.
--
-- Schema changes to `functions`:
--   + version  INTEGER  NOT NULL DEFAULT 1
--   + active   BOOLEAN  NOT NULL DEFAULT TRUE
--   unique constraint becomes (account_id, name, version)
--
-- `function_definitions` data is migrated into `functions` with a JSONB
-- transform that translates the FunctionDef shape (slug/program/args/trigger
-- /cancel_when) into the FenelFunction shape (name/body/params/trigger/cancelWhen).
-- The `args` → `params` transform is best-effort: each `args[k] = {type, required?}`
-- becomes a FieldDef with `name=k` and `type={$named: original_type}`. Required
-- info is dropped for now (FieldDef encodes optionality via $maybe wrapping).
--
-- `function_instances` is retargeted: the `function_definition_id` column is
-- renamed to `function_id` and points at the unified `functions` table. Row IDs
-- are preserved during the data migration so existing FK values stay valid.
--
-- Finally, drop `function_definitions`.

-- 1. Add version + active columns to functions (with defaults so existing rows
--    get version=1, active=true).
ALTER TABLE functions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE functions ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Migrate function_definitions data into functions. JSONB transform
--    converts the runtime FunctionDef shape into the FenelFunction shape.
INSERT INTO functions (id, account_id, name, version, active, function, created_at, updated_at)
SELECT
  fd.id,
  fd.account_id,
  fd.slug AS name,
  fd.version,
  fd.active,
  jsonb_strip_nulls(jsonb_build_object(
    'name',       fd.slug,
    'body',       fd.definition->'program',
    'params',     COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'name', arg_key,
         'type', jsonb_build_object('$named', arg_val->>'type')
       ) ORDER BY arg_key)
       FROM jsonb_each(fd.definition->'args') AS args(arg_key, arg_val)),
      '[]'::jsonb
    ),
    'returns',    jsonb_build_object('$named', 'Boolean'),
    'trigger',    fd.definition->'trigger',
    'cancelWhen', fd.definition->'cancel_when',
    'version',    to_jsonb(fd.version),
    'active',     to_jsonb(fd.active)
  )) AS function,
  fd.created_at,
  fd.created_at AS updated_at
FROM function_definitions fd
ON CONFLICT (id) DO NOTHING;

-- 3. Replace the (account_id, name) unique index with (account_id, name, version).
DROP INDEX IF EXISTS functions_account_name_idx;
CREATE UNIQUE INDEX functions_account_name_version_idx ON functions (account_id, name, version);

-- 4. Retarget function_instances FK. The old constraint name preserves the
--    pre-0023 wording (Postgres doesn't auto-rename constraints when tables/
--    columns are renamed).
ALTER TABLE function_instances DROP CONSTRAINT IF EXISTS flow_instances_flow_definition_id_flow_definitions_id_fk;
ALTER TABLE function_instances RENAME COLUMN function_definition_id TO function_id;
ALTER TABLE function_instances
  ADD CONSTRAINT function_instances_function_id_functions_id_fk
  FOREIGN KEY (function_id) REFERENCES functions(id);

-- 5. Drop the old durable-definitions table.
DROP TABLE function_definitions;
