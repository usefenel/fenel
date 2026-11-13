-- Phase 6: Retire the "flow" name in favor of "function".
-- Every Fenel function is durable; "flow" was just the old word for an
-- IO-suspending function. The DB tables that backed those functions are
-- renamed to align with the type system.
--
-- Renames:
--   flow_definitions       → function_definitions
--   flow_instances         → function_instances
--   flow_spans             → traces  (Span was renamed to Trace earlier)
--   flow_instance_status   → function_instance_status (enum)
--   flow_instances.flow_definition_id → function_definition_id
--   indexes:
--     flow_defs_account_slug_version_idx → function_defs_account_slug_version_idx
--     flow_instances_account_profile_idx → function_instances_account_profile_idx
--     flow_instances_status_idx          → function_instances_status_idx
--     flow_spans_instance_idx            → traces_instance_idx
--     flow_spans_parent_idx              → traces_parent_idx
--     flow_spans_kind_idx                → traces_kind_idx
--
-- The user-defined library `functions` table (per-account FenelFunction
-- records) is unchanged — already named `functions`.

-- 1. Rename the enum type
ALTER TYPE flow_instance_status RENAME TO function_instance_status;

-- 2. Rename tables
ALTER TABLE flow_definitions RENAME TO function_definitions;
ALTER TABLE flow_instances RENAME TO function_instances;
ALTER TABLE flow_spans RENAME TO traces;

-- 3. Rename columns
ALTER TABLE function_instances RENAME COLUMN flow_definition_id TO function_definition_id;

-- 4. Rename indexes
ALTER INDEX flow_defs_account_slug_version_idx RENAME TO function_defs_account_slug_version_idx;
ALTER INDEX flow_instances_account_profile_idx RENAME TO function_instances_account_profile_idx;
ALTER INDEX flow_instances_status_idx RENAME TO function_instances_status_idx;
ALTER INDEX flow_spans_instance_idx RENAME TO traces_instance_idx;
ALTER INDEX flow_spans_parent_idx RENAME TO traces_parent_idx;
ALTER INDEX flow_spans_kind_idx RENAME TO traces_kind_idx;
