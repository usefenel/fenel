-- Phase 6 of unified-dispatch — drop legacy representation columns.
-- See `design/unified-dispatch.md` and `design/representations.md`.
--
-- Label / description for types live in typeclass_instances now
-- (Labelable / Describable instances keyed by the type's slug). The
-- columns on `types` are redundant.
--
-- For functions, the spec used to optionally carry label / description
-- / icon / category inside the `function` JSONB. Those keys are also
-- redundant — same Labelable / Describable / Iconable / Categorizable
-- typeclass instances cover it.
--
-- The accompanying script `scripts/migrate-drop-legacy-repr-columns.ts`
-- performs the JSONB strip + DDL drop in one go. This SQL file
-- captures the same result for fresh setups + drizzle-kit's migration
-- lineage.

-- --- types.label, types.description ----------------------------
ALTER TABLE types DROP COLUMN IF EXISTS label;
ALTER TABLE types DROP COLUMN IF EXISTS description;

-- --- functions.function JSONB key strip ------------------------
UPDATE functions SET function = function - 'label'       WHERE function ? 'label';
UPDATE functions SET function = function - 'description' WHERE function ? 'description';
UPDATE functions SET function = function - 'icon'        WHERE function ? 'icon';
UPDATE functions SET function = function - 'category'    WHERE function ? 'category';
