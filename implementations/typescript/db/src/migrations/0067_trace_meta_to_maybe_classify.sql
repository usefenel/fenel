-- Phase 12 of canonical-maybe (trace-meta-classify arc) — lift `Trace.meta`
-- from `Record<string, unknown>` opaque-bag to canonical `Maybe<TraceMeta>`
-- with `$tag`-discriminated variants (Tier A — semantic-absence lift, not
-- Tier B codec-erasable; runtime values not codec-boundary slots). The TS
-- declaration at `implementations/typescript/engine/src/types.ts` no longer
-- carries `?:` on the meta slot; every persisted Trace row must have `meta`
-- populated as canonical Maybe<TraceMeta> shape (`{$tag:"Nothing"}` or
-- `{$tag:"Just","_0":{$tag:"LetBinding","letName":<...>}}`).
--
-- Load-bearing column: `traces.meta` JSONB — the column root IS the
-- `Trace.meta` slot (NOT in the canonical 9-column walker cluster;
-- writers feed via `runtime/src/evaluator.ts:351 + :1517 + :313 + :541`
-- → `pureTraces[]` → `insertTraces` at `db/src/queries/traces.ts:7-32`
-- which writes directly to that column root; no other persistence path
-- identified). The walker template here operates on the column root
-- directly — no structural walk needed because the column IS the
-- Trace.meta slot.
--
-- Pre-Phase-12 shapes observed:
--   - NULL (no meta) → Nothing
--   - {} (empty meta from spread-conditional default at evaluator.ts:1517
--        pre-Phase-9) → Nothing
--   - {"letName": "X"} (the only real shape — let-binding name carried for
--        the home.tsx byLet trace lookup) → Just(LetBinding {letName: "X"})
--
-- Idempotency: rows already carrying `$tag` at the root (canonical Maybe
-- shape from a previous migration run or a fresh writer post-Phase-12) are
-- left verbatim. Rows with unexpected keys are left verbatim and surface
-- in the ops audit as un-lifted rows (Tier A coverage check post-migration
-- will flag).
--
-- Watch-out: `Trace.meta` is read by the solid inspector's home.tsx letName
-- lookup (around line 5113); the reader was flipped to `peelMaybeValue(t.meta)`
-- + `$tag` dispatch in the same Phase 12 commit. Old rows that fail to
-- migrate would yield `null` from the peel + skip the lookup — degraded
-- but not crashy.

BEGIN;

UPDATE traces
SET meta = CASE
  -- Already canonical Maybe shape — idempotent
  WHEN meta ? '$tag' THEN meta
  -- NULL → Nothing
  WHEN meta IS NULL THEN '{"$tag":"Nothing"}'::jsonb
  -- Empty object → Nothing
  WHEN meta = '{}'::jsonb THEN '{"$tag":"Nothing"}'::jsonb
  -- Has letName → Just(LetBinding {letName})
  WHEN meta ? 'letName' THEN jsonb_build_object(
    '$tag', 'Just',
    '_0', jsonb_build_object(
      '$tag', 'LetBinding',
      'letName', meta->'letName'
    )
  )
  -- Unknown shape — leave verbatim (ops audit will surface)
  ELSE meta
END
WHERE meta IS NULL OR NOT (meta ? '$tag');

COMMIT;
