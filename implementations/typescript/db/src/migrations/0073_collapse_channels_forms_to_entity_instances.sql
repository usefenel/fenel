-- 0073_collapse_channels_forms_to_entity_instances.sql
-- ts-elimination-completion Phase 2b — collapse the three dedicated tables
-- `channels`, `form_definitions`, and `form_submissions` into the generic
-- `entity_instances` store (entity_type 'channel' / 'form' / 'form_submission').
--
-- Background: CLAUDE.md's "Database is not your concern / no dedicated tables
-- for Fenel types". `create_channel` + `create_form` were the only two
-- `core/actions` handlers still writing dedicated tables — so "port to
-- `state:*`" (the entity_instances leaf) was impossible without first moving
-- the data here. FULL COLLAPSE (Rom, 2026-06-02): submissions become typed
-- `form_submission` instances too (NOT keep-table-+-repoint-formId).
--
-- Row shapes (preserve UUIDs — form_definitions ids are the formId FK target
-- of every submission's data.formId):
--   channel:         data = {slug, type, config}
--   form:            data = {slug, scope, scopeEntityType, scopeEntityId,
--                            type, onSubmit, config, behaviorFlow}
--   form_submission: data = {formId, entityType, entityId, profileId,
--                            data, submittedAt}  — the submission payload
--                    nests under the inner `data` key so the read leaves'
--                    `{id, ...data}` flatten reproduces the legacy row shape.
--                    `created_at = submitted_at` (preserves the dashboard's
--                    `ORDER BY submittedAt`). form_submissions has no
--                    account_id → JOIN form_definitions for it.
--
-- Idempotent (each backfill is `to_regclass`-guarded + ON CONFLICT (id) DO
-- NOTHING; drops are IF EXISTS). Roll-forward only — to roll back, the data
-- must be re-migrated from the entity_instances rows back into recreated
-- dedicated tables.
-- Template: 0064_dispatch_registry_to_entity_instances.sql.

-- 1. channels → entity_instances (entity_type='channel')
DO $$
BEGIN
  IF to_regclass('public.channels') IS NOT NULL THEN
    INSERT INTO entity_instances (id, account_id, entity_type, data, created_at, updated_at)
    SELECT
      id,
      account_id,
      'channel',
      jsonb_build_object(
        'slug', slug,
        'type', type,
        'config', COALESCE(config, '{}'::jsonb)
      ),
      created_at,
      created_at
    FROM channels
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-->statement-breakpoint

-- 2. form_definitions → entity_instances (entity_type='form'). Preserve id —
--    it is the formId FK target of every submission below.
DO $$
BEGIN
  IF to_regclass('public.form_definitions') IS NOT NULL THEN
    INSERT INTO entity_instances (id, account_id, entity_type, data, created_at, updated_at)
    SELECT
      id,
      account_id,
      'form',
      jsonb_build_object(
        'slug', slug,
        'scope', scope,
        'scopeEntityType', scope_entity_type,
        'scopeEntityId', scope_entity_id,
        'type', type,
        'onSubmit', COALESCE(on_submit, '[]'::jsonb),
        'config', COALESCE(config, '{}'::jsonb),
        'behaviorFlow', behavior_flow
      ),
      created_at,
      created_at
    FROM form_definitions
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-->statement-breakpoint

-- 3. form_submissions → entity_instances (entity_type='form_submission').
--    JOIN form_definitions for account_id (submissions carry none). The inner
--    `data` key holds the submission payload; `created_at = submitted_at`.
DO $$
BEGIN
  IF to_regclass('public.form_submissions') IS NOT NULL THEN
    INSERT INTO entity_instances (id, account_id, entity_type, data, created_at, updated_at)
    SELECT
      s.id,
      fd.account_id,
      'form_submission',
      jsonb_build_object(
        'formId', s.form_id,
        'entityType', s.entity_type,
        'entityId', s.entity_id,
        'profileId', s.profile_id,
        'data', s.data,
        'submittedAt', s.submitted_at
      ),
      s.submitted_at,
      s.submitted_at
    FROM form_submissions s
    JOIN form_definitions fd ON fd.id = s.form_id
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-->statement-breakpoint

-- 4. Drop the dedicated tables. form_submissions FIRST (FK → form_definitions).
DROP TABLE IF EXISTS form_submissions;

-->statement-breakpoint

DROP TABLE IF EXISTS form_definitions;

-->statement-breakpoint

DROP TABLE IF EXISTS channels;
