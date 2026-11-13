-- Drop the dead `platforms` DB table.
--
-- Platform data lives as a static array in `packages/engine/src/platforms.ts`
-- (consumed via setStaticData → typeclass-derived HandleFormat instances).
-- The DB table was old-architecture residue: pre-existing rows duplicated the
-- static seed and were never queried by any code path.
--
-- The DB schema had drifted from `packages/db/src/schema/platforms.ts`
-- (live: id, account_id, slug, label, builtin, created_at; schema file:
-- name, icon, urlPatterns, handleExtractPattern, baseUrl). Removing the
-- table eliminates the drift entirely. `profileHandles.platform` references
-- platforms.slug as a soft (no-FK) reference; nothing else depends on it.
--
-- Idempotent.

DROP TABLE IF EXISTS "platforms";
