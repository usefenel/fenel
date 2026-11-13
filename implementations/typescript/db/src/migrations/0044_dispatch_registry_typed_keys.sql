-- 0044: Phase 10a sub-step 4 — typeclass_instances → dispatch_registry.
--
-- The semantic shift: dispatch is no longer typeclass-only. The new
-- DispatchKey ADT (ByType | ByValue | ByPattern — see
-- fenel/std/typeclass-specs.fenel) widens the key surface to include
-- typed Id<Type> targets, value-keyed registrations, and structural
-- predicates (Stage 10+ of structural-dispatch). The table rename
-- signals this: the row is a "dispatch registration", not narrowly
-- a "typeclass instance".
--
-- Path A: rename + reshape (smaller blast radius than Path B "drop +
-- route ALL writes through entity_instances"). The legacy `args` jsonb
-- column is preserved as-is; a new `target_entity_type` column is
-- populated from `args[0]` for existing rows so the new lookup path
-- (read via target_entity_type column for ByType keys) works without
-- a per-row JSONB walk. Future writes can set both fields; reads
-- prefer the typed column when present.
--
-- Idempotent. Roll-forward only — to roll back, manually:
--   ALTER TABLE dispatch_registry RENAME TO typeclass_instances;
--   ALTER TABLE typeclass_instances DROP COLUMN target_entity_type;
--   ALTER INDEX dispatch_registry_account_class_idx
--     RENAME TO typeclass_instances_account_class_idx;
--   DROP INDEX dispatch_registry_account_target_idx;

DO $$
BEGIN
  -- Rename only if the legacy table still exists (idempotent guard).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'typeclass_instances'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dispatch_registry'
  ) THEN
    ALTER TABLE typeclass_instances RENAME TO dispatch_registry;
  END IF;
END$$;

-- Add the typed-target column. NULL means "no ByType target" (ByValue /
-- ByPattern keys).
ALTER TABLE dispatch_registry
  ADD COLUMN IF NOT EXISTS target_entity_type TEXT;

-- Populate from the legacy args[0] string for existing rows. Defensive
-- jsonb_typeof guards skip any row whose args is malformed (the
-- registry's legacy contract is `args: jsonb` typed as `unknown[]`, so
-- non-array shapes shouldn't exist in practice).
UPDATE dispatch_registry
SET target_entity_type = args ->> 0
WHERE target_entity_type IS NULL
  AND jsonb_typeof(args) = 'array'
  AND jsonb_array_length(args) >= 1
  AND jsonb_typeof(args -> 0) = 'string';

-- Index for the new typed-target lookup path. Mirrors the existing
-- (account_id, class_name) index but keyed by the typed target column.
CREATE INDEX IF NOT EXISTS dispatch_registry_account_target_idx
  ON dispatch_registry(account_id, target_entity_type);

-- Rename the existing class_name index for clarity (table-rename-
-- consistent). Idempotent — only renames when the old name still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'typeclass_instances_account_class_idx'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'dispatch_registry_account_class_idx'
  ) THEN
    ALTER INDEX typeclass_instances_account_class_idx
      RENAME TO dispatch_registry_account_class_idx;
  END IF;
END$$;
