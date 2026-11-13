-- 0080_drop_page_submissions_table.sql
-- storage-as-effect Phase 4a — page-submit lane collapse (D4 slice 1).
--
-- pages:submitPage now captures a page submission as an INSTANCE of the
-- form's type (state:tryCreateInstanceByName typeRef data) + a page_submitted
-- event, exactly like types:submitFunnel — NO dedicated row. Its sole writer
-- (the `createPageSubmission` leaf) is retired, so the `page_submissions`
-- table is a pure ORPHAN: empty on staging (0 rows), no foreign key in or out,
-- and reader-less after the lane flip. The submission capability survives as
-- instances of the form type in entity_instances (it is collapsed INTO the
-- unified register, not dropped as unwanted).
--
-- System-schema migration (CLAUDE.md exception — dropping a runtime table
-- after its writer is retired is sanctioned). Table empty ⇒ no data path.
-- Idempotent + roll-forward. Mirrors the 0079 (currencies/languages) /
-- 0077 (typeclass_instances) / 0027 (platforms) drop precedent.
-- To roll back, re-run 001_create_pages.sql's CREATE — the orphan held no
-- live-read data.

DROP TABLE IF EXISTS "page_submissions";
