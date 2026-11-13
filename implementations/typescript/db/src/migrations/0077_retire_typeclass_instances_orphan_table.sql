-- 0077_retire_typeclass_instances_orphan_table.sql
-- typed-function-references Phase 9a-4 follow-up — retire the legacy
-- `typeclass_instances` table.
--
-- Migration 0064 (Phase 10a-5d-followup-4) retired the `dispatch_registry` table
-- and made `entity_instances` (rows under `entity_type = <ClassName>`, with the
-- full ClassInstance `data` shape {class, args, methods, targetEntityType}) the
-- EXCLUSIVE home for spec/representation instances. It DELETED the
-- `typeclassInstances` drizzle schema + back-compat alias
-- (db/src/schema/index.ts:15-18) — but never DROPPED the physical Postgres table.
-- It has lingered as an ORPHAN: `createSpecInstance` writes `entity_instances`,
-- `loadAccountRegistry` / `listSpecInstances` read `entity_instances`; NOTHING in
-- the live path reads `typeclass_instances`. Its rows are stale pre-0064
-- snapshots (verified on staging: 40 rows, none with an `entity_instances`
-- equivalent — so they render through NOTHING today).
--
-- This migration RELOCATES the well-formed rows to their correct live home, then
-- drops the orphan. Two row classes on staging:
--   (A) WELL-FORMED (37): real `instance.methods` keyed by a string target id —
--       9 Telegram bot instances × {Labelable, Describable, Iconable, Emojiable}
--       + the `f549232b…` user type's Labelable {"label":"ROAM"}. Relocated into
--       `entity_instances` (shape B) so they become LIVE — what they were
--       authored for before 0064 orphaned the table.
--   (B) MALFORMED (3): `instance.methods IS NULL` — `outfit`/`cf_application_form`
--       Labelable + `outfit` Describable (double-encoded `args`, no payload).
--       Garbage; excluded from the relocation, dropped with the table.
--
-- Non-lossy for meaningful data (relocated, recoverable from `entity_instances`);
-- the DROP only discards the 3 empty malformed rows. Idempotent + roll-forward
-- (`to_regclass`-guarded; relocation has a NOT EXISTS guard so a partial prior
-- run doesn't duplicate). Mirrors the 0073 table-collapse pattern. To roll back,
-- restore from backup — the orphan held no live-read data.

DO $$
BEGIN
  IF to_regclass('public.typeclass_instances') IS NOT NULL THEN
    INSERT INTO entity_instances (account_id, entity_type, data)
    SELECT
      t.account_id,
      t.class_name,
      jsonb_build_object(
        'class', t.class_name,
        'args', t.args,
        'methods', t.instance->'methods',
        'targetEntityType', t.args->>0
      )
    FROM typeclass_instances t
    WHERE t.instance->'methods' IS NOT NULL
      AND jsonb_typeof(t.args) = 'array'
      AND jsonb_typeof(t.args->0) = 'string'
      AND NOT EXISTS (
        SELECT 1 FROM entity_instances e
        WHERE e.entity_type = t.class_name
          AND e.account_id = t.account_id
          AND (e.data->'args'->>0) = (t.args->>0)
      );
  END IF;
END $$;

-->statement-breakpoint

DROP TABLE IF EXISTS typeclass_instances;
