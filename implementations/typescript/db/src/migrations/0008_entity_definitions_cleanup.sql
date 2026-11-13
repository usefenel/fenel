-- Migration: 0008_entity_definitions_cleanup
-- Removes `structure` and `ref_label` columns from entity_definitions.
-- Adds `default_template_inline` column for context-aware inline display templates.
--
-- Rationale:
--   - `structure` ("flat"/"tree"/"graph") was a superfluous declaration — topology
--     is now derived from the schema (self-referential ref = tree).
--   - `ref_label` (field name for display) is replaced by the richer
--     `default_template_inline` (a TypeTemplate name for compact/ref display).
--   - `default_template_inline` complements the existing `default_template` column,
--     giving entity types context-aware display: standard vs inline/compact.

ALTER TABLE "entity_definitions" DROP COLUMN IF EXISTS "structure";
-->statement-breakpoint
ALTER TABLE "entity_definitions" DROP COLUMN IF EXISTS "ref_label";
-->statement-breakpoint
ALTER TABLE "entity_definitions" ADD COLUMN IF NOT EXISTS "default_template_inline" text;
