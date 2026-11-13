-- 0064_dispatch_registry_to_entity_instances.sql
-- Phase 10a-5d-followup-4 — collapse dispatch_registry into entity_instances
-- under entity_type = <className>Spec. The dedicated dispatch_registry table
-- is replaced by entity_instances rows; loadAccountRegistry's union path
-- (account-registries.ts) already reads both sources, so the single-source
-- path is a no-op semantically.
--
-- Background: post-followup-5 (commit 5262143a, 2026-05-27), Constraints
-- carry typed Id<XSpec> end-to-end and dispatch keys carry the typed
-- DispatchKey ADT. With those shapes settled, dispatch_registry is
-- structurally redundant with entity_instances — both are JSONB-keyed-
-- by-name stores; the only thing dispatch_registry adds is the
-- class_name + args + target_entity_type denormalization, all of which
-- are recoverable from the spec record's entity_type + data JSONB.
--
-- Idempotent. Roll-forward only. To roll back, the data must be re-
-- migrated from entity_instances rows under <ClassName>Spec entity_types
-- back into a recreated dispatch_registry table.

-- Pre-cleanup: unwrap any double-encoded JSON instance values. The
-- followup-5 brief flagged 3 stragglers carrying JSON-encoded JSON in
-- the instance column (jsonb_typeof = 'string' instead of 'object').
-- The re-encode step unwraps one level so the migration body's
-- instance->'methods' projection works uniformly.
UPDATE dispatch_registry
SET instance = instance::text::jsonb
WHERE jsonb_typeof(instance) = 'string';

-->statement-breakpoint

-- 1. Backfill: every dispatch_registry row → entity_instances row.
--    entity_type = class_name || 'Spec'
--    data = { class, args, methods, scope?, priority?, targetEntityType? }
--
-- ON CONFLICT (id) DO NOTHING is defensive — preserving UUIDs across the
-- copy means external refs (if any survive) keep working. If a row in
-- entity_instances already shares the UUID, the conflict clause skips it
-- silently (which means SOMETHING ELSE wrote that id first — pre-check
-- via SELECT count(*) FROM dispatch_registry d JOIN entity_instances e
-- ON d.id = e.id should be 0).
INSERT INTO entity_instances (id, account_id, entity_type, data, created_at, updated_at)
SELECT
  id,
  account_id,
  class_name || 'Spec' AS entity_type,
  jsonb_build_object(
    'class', class_name,
    'args', args,
    'methods', COALESCE(instance->'methods', '{}'::jsonb)
  )
  || CASE WHEN instance ? 'scope' THEN jsonb_build_object('scope', instance->'scope') ELSE '{}'::jsonb END
  || CASE WHEN instance ? 'priority' THEN jsonb_build_object('priority', instance->'priority') ELSE '{}'::jsonb END
  || CASE WHEN target_entity_type IS NOT NULL THEN jsonb_build_object('targetEntityType', target_entity_type) ELSE '{}'::jsonb END
  AS data,
  created_at,
  updated_at
FROM dispatch_registry
ON CONFLICT (id) DO NOTHING;

-->statement-breakpoint

-- 2. Drop dispatch_registry table. Its two indexes
-- (dispatch_registry_account_class_idx + dispatch_registry_account_target_idx)
-- and the back-compat alias `typeclassInstances` are dropped with the
-- table. entity_instances's existing (account_id, entity_type) +
-- (account_id) indexes cover the new query patterns.
DROP TABLE IF EXISTS dispatch_registry;
