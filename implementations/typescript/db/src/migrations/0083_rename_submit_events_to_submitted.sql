-- 0083_rename_submit_events_to_submitted.sql
-- storage-as-effect Phase 4c — retire the funnel/form VOCABULARY from the
-- persisted event log (D4 tail; forms-collapse's last data residual).
--
-- There is NO "funnel" and NO "form" concept — only types, functions, and
-- instances (Rom 2026-06-19). A submission is an instance created through a
-- public submit view; the act is one event: `submitted`. The legacy
-- `form_submitted` + `page_submitted` event names (and the `form` aggregate
-- noun) are retired. The code already emits `submitted` (submit.fenel /
-- pages.fenel, Phase 4c); this migration rewrites the persisted rows to match.
--
-- NO `function_triggers` key on either event name (probed 2026-06-19: the
-- triggers table is EMPTY on every event), so renaming the event is
-- behaviorally inert for the trigger fan-out — the reader matches the same
-- string the writer emits. The only non-writer consumer is the UI icon-map
-- (icons.tsx EVENT_STEP_ICONS, repointed to `submitted` in this phase) and the
-- mock seed (seed-mock.ts, repointed). No payload reader exists (grep-clean).
--
-- SNAPSHOT (pre-migration, probed 2026-06-19 on staging):
--   • 25 events with type='form_submitted', aggregate_type='form',
--     aggregate_id='2034678f-bb36-4587-9862-eca64626dc93' (the contact-form
--     formId — seed/mock analytics rows), payload={} (EMPTY; no `funnel` /
--     `submissionId` keys — so the brief's funnel→type payload rename is a
--     no-op here; instead the empty payload is FILLED to the new shape).
--   • 0 events with type='page_submitted'.
--
-- System-data migration (CLAUDE.md exception — a sanctioned one-shot row move
-- over real staging rows). NOT a schema change — `events` is untouched
-- structurally. SQL via scripts/run-sql.ts (invokeIOAction hangs on a cold
-- standalone bun process on Rom's Windows machine — 4b/4d precedent).
-- Transactional (BEGIN/COMMIT) + idempotent (WHERE type=<old> finds 0 on
-- re-run). Reversible — see ROLLBACK.
--
-- ROLLBACK (the original payloads were {} so re-emptying is lossless):
--   BEGIN;
--   UPDATE events
--   SET type = 'form_submitted', aggregate_type = 'form', payload = '{}'::jsonb
--   WHERE type = 'submitted' AND aggregate_type = 'contact-form';
--   -- (page_submitted had 0 rows at HEAD; the page-lane rollback would be
--   --  UPDATE events SET type='page_submitted' WHERE type='submitted'
--   --  AND aggregate_type='page' — a no-op.)
--   COMMIT;

BEGIN;

-- The 25 form_submitted rows → the unified `submitted` event. The event name,
-- the `form` noun in aggregate_type, and the empty payload all align to the
-- new { type, instanceId } shape a live submit emits (no funnel/form noun).
-- The mock rows' aggregate_id is the contact-form's id, used as the instance
-- stand-in (these are seed analytics rows, not real captures).
UPDATE events
SET type = 'submitted',
    aggregate_type = 'contact-form',
    payload = jsonb_build_object('type', 'contact-form', 'instanceId', aggregate_id::text)
WHERE type = 'form_submitted';

-- page_submitted → submitted (0 rows at HEAD; included for completeness +
-- idempotency). Any future-persisted page rows carry their own
-- { type, instanceId, ... } payload from the Phase-4c pages.fenel emit, so
-- only the event NAME needs aligning here.
UPDATE events
SET type = 'submitted'
WHERE type = 'page_submitted';

COMMIT;
