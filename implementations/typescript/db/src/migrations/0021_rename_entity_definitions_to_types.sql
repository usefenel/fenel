-- Migration: 0021_rename_entity_definitions_to_types
-- Phase 9.I — promote entity_definitions to its architectural role:
-- the types registry. Entity-extras (staticData, relations) live on
-- the in-code systemEntities array; the DB table is a pure FenelType
-- registry, so naming it `types` matches what it actually is.
--
-- Renames:
--   entity_definitions          → types
--   entity_defs_account_name_idx → types_account_name_idx
--   entity_defs_account_idx      → types_account_idx
--
-- Indexes are renamed in-place; data is untouched.

ALTER TABLE "entity_definitions" RENAME TO "types";
-->statement-breakpoint
ALTER INDEX "entity_defs_account_name_idx" RENAME TO "types_account_name_idx";
-->statement-breakpoint
ALTER INDEX "entity_defs_account_idx" RENAME TO "types_account_idx";
