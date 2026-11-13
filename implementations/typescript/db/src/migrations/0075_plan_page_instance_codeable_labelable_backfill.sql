-- 0075_plan_page_instance_codeable_labelable_backfill.sql
-- typed-function-references Phase 9a-2.2 — Codeable-on-instances, the SWEEP
-- (the item PILOT of 0074 generalized across the remaining live, instance-
-- resident product entities: `plan` + `page`).
--
-- Backfills the representational projections onto EXISTING `plan` / `page`
-- instances so pre-hook rows are first-class Codeable-bearing values, matching
-- what the createInstance attach hook (`attachInstanceRepresentations` in
-- runtime/handlers/state.ts) now writes for every newly-created plan/page once
-- their `representationSources: { codeName: "slug", label: "name" }` is declared
-- (system-entities.ts):
--   - Codeable  { codeName ← data->>'slug' }  (machine identity)
--   - Labelable { label    ← data->>'name' }  (display name)
--
-- Spec instances live in `entity_instances` under entity_type = <className>
-- (post-0064 single-source; `createSpecInstance` shape B = {class, args,
-- methods, targetEntityType}). `loadAccountRegistry` reads these by
-- entity_type IN specCodeNameToClassName.keys() (which includes Codeable /
-- Labelable) into the in-memory specRegistry — so these rows are the LIVE
-- dispatch projection, not dead metadata.
--
-- ADDITIVE + non-destructive: the source `slug` / `name` fields STAY in the
-- row's JSONB `data` (read across the funnel product); this only PROJECTS
-- their values. No field removal, no UPDATE of plan/page rows, no DROP.
-- Idempotent (NOT EXISTS guard on the (className, args[0]) pair). Reversible:
--   DELETE FROM entity_instances
--   WHERE entity_type IN ('Codeable','Labelable')
--     AND (data->'args'->>0) IN (
--       SELECT id::text FROM entity_instances WHERE entity_type IN ('plan','page'));
--
-- INERT to existing consumers: resolveNamed's Codeable fallback resolves
-- args[0] against systemEntities (codeName-keyed) — instance rows carry a row
-- UUID in args[0], which never matches a system-entity id, so they cannot
-- shadow a type/function codeName. The forward consumer is Phase 9b
-- (the scoped name→value inverse). Cross-entity slug collisions measured 0
-- (item/plan/page slugs independently namespaced); any future collision
-- surfaces via 9b's `Conflict` arm, not a silent overwrite.

-- 1. Codeable ← slug (machine identity). Only plan/page rows with a non-empty slug.
INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  e.account_id,
  'Codeable',
  jsonb_build_object(
    'class', 'Codeable',
    'args', jsonb_build_array(e.id::text),
    'methods', jsonb_build_object('codeName', e.data->>'slug'),
    'targetEntityType', e.id::text
  )
FROM entity_instances e
WHERE e.entity_type IN ('plan', 'page')
  AND COALESCE(e.data->>'slug', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM entity_instances c
    WHERE c.entity_type = 'Codeable'
      AND c.account_id = e.account_id
      AND (c.data->'args'->>0) = e.id::text
  );

-->statement-breakpoint

-- 2. Labelable ← name (display). Only plan/page rows with a non-empty name.
INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  e.account_id,
  'Labelable',
  jsonb_build_object(
    'class', 'Labelable',
    'args', jsonb_build_array(e.id::text),
    'methods', jsonb_build_object('label', e.data->>'name'),
    'targetEntityType', e.id::text
  )
FROM entity_instances e
WHERE e.entity_type IN ('plan', 'page')
  AND COALESCE(e.data->>'name', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM entity_instances l
    WHERE l.entity_type = 'Labelable'
      AND l.account_id = e.account_id
      AND (l.data->'args'->>0) = e.id::text
  );
