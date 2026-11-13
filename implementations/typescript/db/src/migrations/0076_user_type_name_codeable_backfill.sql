-- 0076_user_type_name_codeable_backfill.sql
-- typed-function-references Phase 9a-4 — Codeable-for-user-types, the types tier.
--
-- Phase 9a-4 dropped `name` from the `entity_definition` $record: a user type's
-- identity is now its Codeable projection (codeName ← name), symmetric with how
-- a function carries Codeable via defineFunction and a system type via
-- defineSystemEntity. Newly created/edited user types get the Codeable instance
-- written frontend-side by `persistCommonRepresentations` → POST /spec-instances
-- → `createSpecInstance` (the same path that already writes Labelable ← label /
-- Describable ← description). This migration backfills the Codeable instance onto
-- EXISTING user types so pre-9a-4 rows are first-class Codeable-bearing values.
--
-- TARGET TABLE = `entity_instances` (NOT the orphaned `typeclass_instances`).
-- Migration 0064 retired the `dispatch_registry` table and made `entity_instances`
-- the EXCLUSIVE home for spec/representation instances: rows under
-- `entity_type = <ClassName>` with the full ClassInstance `data` shape
-- {class, args, methods, targetEntityType?}. `createSpecInstance`
-- (db/queries/dispatch-registry.ts) — the live /spec-instances write path — and
-- the 0074/0075 item/plan/page backfills all write here; `loadAccountRegistry` /
-- `listSpecInstances` read here. The physical `typeclass_instances` table still
-- exists on some DBs holding STALE pre-0064 rows but is read by nothing — a
-- legacy orphan slated for retirement (see Phase 9a-4 Surprise 1). Row shape
-- mirrors 0074 exactly so the in-memory specRegistry resolves getCodeName.
--
-- Scope: user types only (`is_system = false`). System types carry their Codeable
-- from defineSystemEntity at engine boot — backfilling them would duplicate.
--
-- ADDITIVE + non-destructive: the source `types.name` column STAYS the persistence
-- KEY (read by getType / upsertType / enrichTypeRow); this only PROJECTS its value
-- as a Codeable codeName. No column drop, no row UPDATE. Idempotent (NOT EXISTS
-- guard on the (entity_type, account_id, args[0]) triple). Reversible:
--   DELETE FROM entity_instances ei
--   WHERE ei.entity_type = 'Codeable'
--     AND (ei.data->'args'->>0) IN (SELECT name FROM types WHERE is_system = false);

INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  t.account_id,
  'Codeable',
  jsonb_build_object(
    'class', 'Codeable',
    'args', jsonb_build_array(t.name),
    'methods', jsonb_build_object('codeName', t.name),
    'targetEntityType', t.name
  )
FROM types t
WHERE t.is_system = false
  AND COALESCE(t.name, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM entity_instances c
    WHERE c.entity_type = 'Codeable'
      AND c.account_id = t.account_id
      AND (c.data->'args'->>0) = t.name
  );
