-- 0082_consolidate_cf_application_to_pascalcase.sql
-- storage-as-effect Phase 4d — consolidate the LIVE cf_application type to ONE
-- `CFApplication` (PascalCase, no `_form` suffix), in one transactional,
-- reversible migration. UNBLOCKS 4c Stage B.
--
-- Rom decision (2026-06-19): "we use PascalCase for types, cf_application_form
-- should be renamed to CFApplication basically." A form is a *view* over a type,
-- not the type — so the name drops the `_form` suffix and names what the type IS.
-- CLAUDE.md § "Entity codenames are PascalCase": ship a migration that updates
-- existing rows AND every reference together.
--
-- THE TWO-GENERATION CONSOLIDATION (probed FRESH on staging 2026-06-19, account
-- be2423f7-1161-423d-8e93-c8ee00ff6845 — Bayne's DEFAULT_ACCOUNT_ID): there are
-- TWO competing `types` rows for this one concept:
--   • 530c7e73-7ae9-472e-bc72-0e2e7ff979bc  cf_application_form  — 7 fields, the
--     OLDER generation, orphan (its ONLY referents are the 2 transient Drafts).
--   • 5bc56efd-bd94-47de-844e-491d102b29ab  cf_application       — 11 fields, the
--     NEWER generation (forms-collapse), the one the LIVE behavior.fenel funnel
--     captures into + the only one with application_type/email/terms.
-- entity_instances holds ONLY 2 `Draft<cf_application_form>` rows (the Telegram
-- collector's in-flight test drafts on the OLDER 7-field shape). ZERO completed
-- `cf_application` rows.
--
-- WHAT THIS DOES (transactional; the canonical schema = the 11-field row,
-- settled by measurement — it is the live funnel's capture target):
--   (a) DROP the 2 test Drafts (D-A-i, RECOMMENDED — Rom: staging bot is test-only,
--       no real users; these reference a schema being deleted, hold no real user
--       data, and are mid-collection transient state a fresh collection re-creates).
--   (b) RENAME the canonical 11-field row cf_application → CFApplication.
--   (c) DELETE the orphan 7-field cf_application_form row.
--
-- System-data migration (CLAUDE.md exception — a sanctioned one-shot row move over
-- real staging rows). NOT a schema change — `entity_instances`/`types` are
-- untouched structurally. SQL via scripts/run-sql.ts, NOT invokeIOAction (the 4b
-- wall: a cold standalone bun process driving invokeIOAction hangs on Windows).
--
-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK SNAPSHOT (the dropped rows' full JSON — the inverse re-creates them):
--
-- (a) The 2 dropped Draft<cf_application_form> rows (account be2423f7-…):
--   id=7482b9cc-c647-45c5-892c-5e911c0a51a4  created_at=2026-05-17T23:50:39.615Z
--     data={"how_did_you_find_bayne":{"$tag":"Right","value":"test_here"},
--           "what_is_your_ig_handle":{"var":"rawText","$tag":"Left"}}
--   id=71412c35-eac2-4950-aca8-576c0021fa0f  created_at=2026-05-17T23:54:14.133Z
--     data={"how_did_you_find_bayne":{"$tag":"Right","value":"test_here"},
--           "what_is_your_ig_handle":{"$tag":"Left","value":"@Jhssssda"}}
--
-- (c) The deleted 7-field cf_application_form type row (530c…, is_system=false):
--   type={"$record":{"fields":[
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"how_did_you_find_bayne","type":{"$named":"String"},"label":{"_0":"HOW DID YOU FIND BAYNE?","$tag":"Just"}},
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"why_do_you_want_to_be_in_his_close_friends","type":{"$named":"String"},"label":{"_0":"WHY DO YOU WANT TO BE IN HIS CLOSE FRIENDS?","$tag":"Just"}},
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"what_do_you_do_for_work","type":{"$named":"String"},"label":{"_0":"WHAT DO YOU DO FOR WORK?","$tag":"Just"}},
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"meta":{"refEntityType":"country"},"name":"where_are_you_based","type":{"$tagged":{"value":{"$named":"Id"},"phantom":{"$refined":{"set":{"$enum":["country"]},"base":{"$named":"String"}}}}},"label":{"_0":"WHERE ARE YOU BASED?","$tag":"Just"}},
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"name_your_1_proudest_accomplishment","type":{"$named":"String"},"label":{"_0":"NAME YOUR #1 PROUDEST ACCOMPLISHMENT","$tag":"Just"}},
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"describe_yourself_in_high_school","type":{"$named":"String"},"label":{"_0":"DESCRIBE YOURSELF IN HIGH-SCHOOL","$tag":"Just"}},
--     {"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"what_is_your_ig_handle","type":{"$refined":{"set":{"$named":"format:handle"},"base":{"$named":"String"}}},"label":{"_0":"WHAT IS YOUR IG HANDLE","$tag":"Just"}}]}}
--
-- INVERSE SQL (best-effort byte-restore from the snapshot above):
--   BEGIN;
--   UPDATE types SET name='cf_application'
--     WHERE id='5bc56efd-bd94-47de-844e-491d102b29ab' AND name='CFApplication';
--   INSERT INTO types (id, account_id, name, type, is_system)
--     VALUES ('530c7e73-7ae9-472e-bc72-0e2e7ff979bc',
--             'be2423f7-1161-423d-8e93-c8ee00ff6845', 'cf_application_form',
--             '<the 7-field type JSON above>'::jsonb, false);
--   INSERT INTO entity_instances (id, account_id, entity_type, data, created_at)
--     VALUES (<the 2 Draft rows above>);
--   COMMIT;
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- (a) DROP the 2 test Drafts (D-A-i) — referencing the schema being deleted.
DELETE FROM entity_instances WHERE entity_type = 'Draft<cf_application_form>';

-- (b) RENAME the canonical 11-field type row → CFApplication.
UPDATE types
  SET name = 'CFApplication'
  WHERE id = '5bc56efd-bd94-47de-844e-491d102b29ab' AND name = 'cf_application';

-- (c) DELETE the orphan 7-field type row.
DELETE FROM types
  WHERE id = '530c7e73-7ae9-472e-bc72-0e2e7ff979bc' AND name = 'cf_application_form';

COMMIT;
