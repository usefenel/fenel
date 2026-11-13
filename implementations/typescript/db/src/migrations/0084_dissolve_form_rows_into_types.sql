-- 0084_dissolve_form_rows_into_types.sql
-- storage-as-effect Phase 4e — Stage B of forms-collapse: dissolve the 3 orphan
-- `entity_type='form'` rows into their types. There is NO "form" concept (Rom
-- 2026-06-19): a form is the auto-derived input VIEW over a type, decomposing
-- with no residue into (1) the type's $record, (2) the type's Codeable codeName
-- (= the public URL slug), (3) the type's representations (the submit CTA =
-- Submittable), and (4) the type's function (the dissolved onSubmit). This
-- migration registers the missing `Sizing` type, mints the 3 public-slug
-- Codeables, preserves cf_application's `submit_label` as a `Submittable`
-- representation, drops the stale `cf_application_form` Codeable, and deletes the
-- 3 form rows — so "a form" exists NOWHERE as data.
--
-- System-data migration (CLAUDE.md exception — a sanctioned one-shot row move
-- over real staging rows). NOT a schema change (`types` / `entity_instances` are
-- untouched structurally). SQL via scripts/run-sql.ts because invokeIOAction
-- hangs on a cold standalone bun process on Rom's Windows machine (4b/4d/4c
-- precedent); a one-shot id mint via the column DEFAULT gen_random_uuid() is the
-- sanctioned 4b/4d precedent (the runtime path mints via crypto:uuidV4 in the
-- create handler — storage-as-effect Phase 1). Transactional (BEGIN/COMMIT) +
-- idempotent (every INSERT is NOT-EXISTS-guarded; the DELETEs find 0 on re-run).
--
-- SNAPSHOT (pre-migration, probed 2026-06-19 on staging) — for reversibility:
--
-- The 3 entity_type='form' rows (DELETED by this migration):
--   • 7903816e-e467-4861-80a3-0c350c4a2053 (account be2423f7) slug=cf_application
--     {"slug":"cf_application","type":{"$record":{"fields":[{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"read_layers","type":"checkbox","label":{"_0":"I will/have read the LAYERS book before joining Bayne's Close Friends","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"how_found","type":"text","label":{"_0":"How did you find Bayne?","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"why_join","type":"textarea","label":{"_0":"Why do you want to be in his close friends?","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"work","type":"text","label":{"_0":"What do you do for work?","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"location","type":"text","label":{"_0":"Where are you based?","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"accomplishment","type":"textarea","label":{"_0":"Name your #1 proudest accomplishment","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"high_school","type":"textarea","label":{"_0":"Describe yourself in high-school","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"ig_handle","type":"text","label":{"_0":"What is your IG handle","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"application_type","type":"radio","label":{"_0":"Application Type","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"email","type":"email","label":{"_0":"Email","$tag":"Just"}},{"ui":{"$tag":"Nothing","format":{"$tag":"Nothing"},"prefix":{"$tag":"Nothing"},"suffix":{"$tag":"Nothing"}},"name":"terms","type":"checkbox","label":{"_0":"Accept the Terms of Service","$tag":"Just"}}]}},"scope":"account","config":{"submit_label":"APPLY FOR FREE"},"onSubmit":[{"if":{"_0":"$form.application_type == \"instant\"","$tag":"Just"},"then":{"create_payment_link":{"plan":"cf_instant","redirect":true}}},{"else":{"show_page":"thanks_regular"}}],"behaviorFlow":null,"scopeEntityId":null,"scopeEntityType":null}
--       (type superseded by CFApplication 5bc56efd; onSubmit superseded by the
--        cf_application function + the cfApplication demo body; the ONLY
--        non-superseded datum is config.submit_label, preserved as Submittable.)
--   • 2034678f-bb36-4587-9862-eca64626dc93 (account f7297767) slug=contact-form
--     {"slug":"contact-form","type":{"$record":{"fields":[{...name,email,message ($named String)...}]}},"scope":"account","config":{},"onSubmit":[],"behaviorFlow":null,"scopeEntityId":null,"scopeEntityType":null}
--       (fully superseded — type = ContactMessage af58c889; config/onSubmit empty.)
--   • 957ea421-cd46-4152-9b4d-3338d53acbd7 (account f7297767) slug=sizing-form
--     {"slug":"sizing-form","type":{"$record":{"fields":[{...height,weight,shoe_size ($named Number), fit_pref ($named String)...}]}},"scope":"account","config":{},"onSubmit":[],"behaviorFlow":null,"scopeEntityId":null,"scopeEntityType":null}
--       (type registered here as Sizing in the modern $ref shape; config/onSubmit empty.)
--
-- The stale Codeable (DELETED by this migration):
--   • 4274ac5b-a15d-4585-899f-7936f5c6c14b (account be2423f7)
--     {"args":["cf_application_form"],"class":"Codeable","methods":{"codeName":"cf_application_form"},"targetEntityType":"cf_application_form"}
--       (codeName/target = the cf_application_form string-id type DELETED at 4d.)
--
-- ROLLBACK (re-insert the 3 form rows + the stale Codeable from the snapshot
-- above; drop the 3 minted Codeables, the Submittable, and the Sizing type):
--   BEGIN;
--   DELETE FROM entity_instances WHERE entity_type='Codeable' AND data->'methods'->>'codeName' IN ('cf_application','contact-form','sizing-form');
--   DELETE FROM entity_instances WHERE entity_type='Submittable' AND data->>'targetEntityType'='5bc56efd-bd94-47de-844e-491d102b29ab';
--   DELETE FROM types WHERE name='Sizing' AND account_id='f7297767-1a09-4f9e-ad7f-686e2e235beb';
--   -- re-INSERT the 3 form rows + the cf_application_form Codeable from the snapshot.
--   COMMIT;

BEGIN;

-- 1. Register the missing `Sizing` type (account f7297767) in the modern $ref,
-- cleaned shape (mirroring ContactMessage — drop the legacy ui:{$tag:Nothing,…}
-- clutter the form row carried). The id is column-DEFAULT-minted.
INSERT INTO types (account_id, name, is_system, type)
SELECT
  'f7297767-1a09-4f9e-ad7f-686e2e235beb',
  'Sizing',
  false,
  '{"$record":{"fields":[
    {"name":"height","type":{"$ref":"Number"},"label":{"_0":"Height (cm)","$tag":"Just"}},
    {"name":"weight","type":{"$ref":"Number"},"label":{"_0":"Weight (kg)","$tag":"Just"}},
    {"name":"shoe_size","type":{"$ref":"Number"},"label":{"_0":"Shoe Size (EU)","$tag":"Just"}},
    {"name":"fit_pref","type":{"$ref":"String"},"label":{"_0":"Fit Preference","$tag":"Just"}}
  ]}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM types WHERE name = 'Sizing' AND account_id = 'f7297767-1a09-4f9e-ad7f-686e2e235beb'
);

-- 2a. sizing-form → Sizing (resolve the just-minted id by name).
INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  'f7297767-1a09-4f9e-ad7f-686e2e235beb',
  'Codeable',
  jsonb_build_object(
    'args', jsonb_build_array(t.id::text),
    'class', 'Codeable',
    'methods', jsonb_build_object('codeName', 'sizing-form'),
    'targetEntityType', t.id::text
  )
FROM types t
WHERE t.name = 'Sizing' AND t.account_id = 'f7297767-1a09-4f9e-ad7f-686e2e235beb'
  AND NOT EXISTS (
    SELECT 1 FROM entity_instances
    WHERE entity_type = 'Codeable' AND data->'methods'->>'codeName' = 'sizing-form'
  );

-- 2b. cf_application → CFApplication (5bc56efd, account be2423f7).
INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  'be2423f7-1161-423d-8e93-c8ee00ff6845',
  'Codeable',
  jsonb_build_object(
    'args', jsonb_build_array('5bc56efd-bd94-47de-844e-491d102b29ab'),
    'class', 'Codeable',
    'methods', jsonb_build_object('codeName', 'cf_application'),
    'targetEntityType', '5bc56efd-bd94-47de-844e-491d102b29ab'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM entity_instances
  WHERE entity_type = 'Codeable' AND data->'methods'->>'codeName' = 'cf_application'
);

-- 2c. contact-form → ContactMessage (af58c889, account f7297767).
INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  'f7297767-1a09-4f9e-ad7f-686e2e235beb',
  'Codeable',
  jsonb_build_object(
    'args', jsonb_build_array('af58c889-0850-4ca9-80a6-70d0755153dd'),
    'class', 'Codeable',
    'methods', jsonb_build_object('codeName', 'contact-form'),
    'targetEntityType', 'af58c889-0850-4ca9-80a6-70d0755153dd'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM entity_instances
  WHERE entity_type = 'Codeable' AND data->'methods'->>'codeName' = 'contact-form'
);

-- 3. Preserve cf_application's submit_label as a Submittable representation on
-- CFApplication (5bc56efd, account be2423f7) — the public CTA "APPLY FOR FREE".
INSERT INTO entity_instances (account_id, entity_type, data)
SELECT
  'be2423f7-1161-423d-8e93-c8ee00ff6845',
  'Submittable',
  jsonb_build_object(
    'args', jsonb_build_array('5bc56efd-bd94-47de-844e-491d102b29ab'),
    'class', 'Submittable',
    'methods', jsonb_build_object('submitLabel', 'APPLY FOR FREE'),
    'targetEntityType', '5bc56efd-bd94-47de-844e-491d102b29ab'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM entity_instances
  WHERE entity_type = 'Submittable' AND data->>'targetEntityType' = '5bc56efd-bd94-47de-844e-491d102b29ab'
);

-- 4. Drop the stale cf_application_form Codeable (target = a deleted string-id type).
DELETE FROM entity_instances
WHERE entity_type = 'Codeable' AND data->'methods'->>'codeName' = 'cf_application_form';

-- 5. Delete the 3 orphan form rows (no live reader; robust entity_type predicate).
DELETE FROM entity_instances WHERE entity_type = 'form';

COMMIT;
