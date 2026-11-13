-- 0081_migrate_form_submissions_to_contact_message.sql
-- storage-as-effect Phase 4b — form-submission instance migration (D4 slice 2).
--
-- A submission is an INSTANCE of the form's own type, not a generic envelope.
-- The `form_submission`-as-a-generic-entity-type concept is REJECTED (Rom
-- 2026-06-19) — it should never have existed. This migration retires the last
-- 12 legacy `entity_type='form_submission'` envelope rows by turning them into
-- instances of `ContactMessage`, the registered type the contact-form's inline
-- `$record {name,email,message}` becomes.
--
-- The 12 rows are all submissions of ONE form (slug `contact-form`,
-- formId 2034678f-bb36-4587-9862-eca64626dc93, account
-- f7297767-1a09-4f9e-ad7f-686e2e235beb), 0 orphans — the form row still exists.
-- That form is a pre-forms-collapse legacy form carrying its type inline; it was
-- never re-platformed into a registered type (unlike cf_application, which the
-- forms-collapse `register_type` lane did re-platform — the precedent this
-- mirrors). So step (a) registers ContactMessage; step (b) migrates the rows.
--
-- (a) REGISTER THE TYPE — ContactMessage, the contact-form's $record, into the
--     `types` registry table (the SAME write target types:registerType /
--     POST /types use). Authored directly via SQL: invokeIOAction (the
--     types:registerType action) hangs on a cold standalone bun process on
--     Rom's Windows machine (see scripts/seed-cf-application.ts NOTE), so —
--     exactly as forms-collapse pre-created the cf_application `types` row via
--     SQL — this registers the row directly. is_system=false, account-scoped.
--     Idempotent (WHERE NOT EXISTS). $ref type-handles match the modern
--     registered-type shape (cf_application); no retired `default` slot (0078).
--
-- (b) MIGRATE THE ROWS — each of the 12 form_submission rows becomes a
--     ContactMessage instance carrying ONLY the payload (`data->'data'` =
--     {name,email,message}). D2 LOCKED (Rom 2026-06-19, match-modern): the
--     envelope linkage (formId/entityId/profileId/entityType/submittedAt) is
--     DROPPED — the rows are test data and, with the linkage gone, a backdated
--     `form_submitted` event would carry ~nothing, so NO event is synthesized.
--     created_at is already == submittedAt (no-op). The row id / account_id are
--     preserved (stable refs). Idempotent (re-running finds 0 form_submission
--     rows). The migrated instances render through the universal
--     /types/ContactMessage instance browser — reference/submission data needs
--     no special reader (the Phase-3d theme).
--
-- System-data migration (CLAUDE.md exception — a sanctioned one-shot row move
-- over real staging rows). NOT a schema change — `entity_instances` is untouched
-- structurally. The pre-migration full row data is captured in the Phase-4b
-- session transcript (a backup snapshot) for an out-of-band restore if needed.
--
-- ROLLBACK (best-effort — the dropped linkage is NOT recoverable from the
-- migrated row, by D2 design; restore the dropped fields from the session
-- backup snapshot if a full byte-restore is required):
--   UPDATE entity_instances
--   SET entity_type = 'form_submission',
--       data = jsonb_build_object(
--         'data', data,
--         'formId', '2034678f-bb36-4587-9862-eca64626dc93',
--         'submittedAt', to_char(created_at AT TIME ZONE 'UTC',
--                                'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'))
--   WHERE entity_type = 'ContactMessage'
--     AND account_id = 'f7297767-1a09-4f9e-ad7f-686e2e235beb'::uuid;
--   DELETE FROM types
--   WHERE name = 'ContactMessage'
--     AND account_id = 'f7297767-1a09-4f9e-ad7f-686e2e235beb'::uuid;

INSERT INTO types (account_id, name, type, is_system)
SELECT
  'f7297767-1a09-4f9e-ad7f-686e2e235beb'::uuid,
  'ContactMessage',
  '{"$record":{"fields":[{"name":"name","type":{"$ref":"String"},"label":{"$tag":"Just","_0":"Full Name"}},{"name":"email","type":{"$ref":"String"},"label":{"$tag":"Just","_0":"Email"}},{"name":"message","type":{"$ref":"String"},"label":{"$tag":"Just","_0":"Message"}}]}}'::jsonb,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM types
  WHERE account_id = 'f7297767-1a09-4f9e-ad7f-686e2e235beb'::uuid
    AND name = 'ContactMessage'
);
-->statement-breakpoint
UPDATE entity_instances
SET entity_type = 'ContactMessage',
    data = data->'data'
WHERE entity_type = 'form_submission'
  AND account_id = 'f7297767-1a09-4f9e-ad7f-686e2e235beb'::uuid;
