-- universal-dispatch-convergence Phase 3 (sub-pass B+C+A) — rename the persisted
-- dispatch-instance JSONB key `data.class` -> `data.type`, the terminal spelling
-- of the dispatch-Type-name field (in-memory `Instance.typeName`). The whole
-- marshal boundary (TS `Instance` field + the ~37 `.fenel` resolver/IR/factory
-- bodies + the frame-spec key) moved to `typeName`/`type` in the same commit;
-- this migration flips the AT-REST data so `projectEntityToInstance` reads the
-- terminal `data.type` key (it keeps a legacy `data.class` read-fallback for any
-- un-swept row, so this migration is not load-bearing for correctness — only for
-- retiring the legacy key).
--
-- FOOTPRINT: only shape-(B) full-Instance rows carry a top-level `class` key —
-- `{class, args, methods, scope?, priority?, targetEntityType?}`, written by
-- `createDispatchInstance` (the dashboard surface) and emitted by migration 0064
-- from the pre-existing dispatch_registry rows. Shape-(A) flat-methods rows
-- (`state.try_create_instance` output) carry NO `class` key (their Type name is
-- the `entity_type` column) and are untouched. Guarded on `data ? 'class' AND
-- data ? 'methods'`.
--
-- Idempotent + defensive. Roll-forward only. Re-running is a no-op (no `class`
-- key remains after the first pass). Rows that somehow already carry `type` are
-- left as-is (only the stray `class` key is dropped), never overwritten.

BEGIN;

-- Primary rename: move `data.class` -> `data.type` for shape-(B) rows that don't
-- already carry a `type` key.
UPDATE entity_instances
SET data = (data - 'class') || jsonb_build_object('type', data->'class')
WHERE data ? 'class'
  AND data ? 'methods'
  AND NOT (data ? 'type');

-- Defensive sweep: drop any residual `class` key on a row that already has `type`
-- (e.g. a partially-migrated row) — the `type` value is authoritative.
UPDATE entity_instances
SET data = data - 'class'
WHERE data ? 'class'
  AND data ? 'methods'
  AND data ? 'type';

COMMIT;
