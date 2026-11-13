-- Phase 12 of canonical-maybe (trace-meta-classify arc) — lift
-- `SuspendAction.meta` payload from scattered underscored top-level keys
-- on `function_instances.variables` into a single canonical `_suspendMeta`
-- nested slot carrying a `SuspendMeta` `$tag`-discriminated variant. The
-- TS declaration of `IOHandlerResult` (`engine/src/types.ts`) carries
-- `meta: Maybe<SuspendMeta>`; the runtime's `saveState`
-- (`runtime/src/evaluator.ts`) now `peelMaybeValue`s the meta and writes
-- the unwrapped SuspendMeta to `variables._suspendMeta` (Just case) or
-- skips the write (Nothing case). Readers (`runtime/src/triggers.ts` +
-- `fenel/modules/dashboard/io.fenel`) dispatch on `_suspendMeta.$tag`
-- instead of duck-typing the legacy underscored keys.
--
-- Load-bearing column: `function_instances.variables` JSONB — the suspend
-- payload was spread into the column root via the pre-Phase-12 saveState's
-- `Object.assign(variables, meta)`, so underscored keys (`_waitFilter` /
-- `_readSchema` / `_wakeAt` / `_telegramRetryReason` /
-- `_notionRetryReason`) lived as top-level siblings of `_evalStack` /
-- `_letTarget` and the user-defined function bindings. Reader sites in
-- `runtime/src/triggers.ts:212 + :265 + :309` were flipped to read
-- `vars._suspendMeta` + dispatch on `$tag`; same for the Fenel body
-- `projectAwaitingRow` at `fenel/modules/dashboard/io.fenel:131-143`.
--
-- Detection: any row with `_waitFilter` / `_readSchema` / `_wakeAt` at top
-- level of `variables`. Action: bundle into a `_suspendMeta` slot with
-- the appropriate `$tag` + payload + remove the legacy underscored keys.
--
-- Lift rules (in priority order — the WHEN cascade matches the first):
--
--   1. `_wakeAt` + `_telegramRetryReason` →
--      `{$tag: "WaitTimer", wakeAt, retryReason: Just(TelegramRetry {
--        description: <_telegramRetryReason>
--      })}`
--   2. `_wakeAt` + `_notionRetryReason` →
--      `{$tag: "WaitTimer", wakeAt, retryReason: Just(NotionRetry {
--        description: <_notionRetryReason>
--      })}`
--   3. `_wakeAt` (no retry reason) →
--      `{$tag: "WaitTimer", wakeAt, retryReason: Nothing}`
--   4. `_waitFilter` →
--      `{$tag: "WaitEvent", event: <_waitFilter.event>, filter: <_waitFilter>}`
--   5. `_readSchema` →
--      `{$tag: "AwaitingChoice", schema: <_readSchema>}`
--
-- Idempotency: rows already carrying `_suspendMeta` are left untouched
-- (this preserves prior-migration runs + fresh writer post-Phase-12 rows).
--
-- Watch-out: this migration is load-bearing for durable resume — the
-- runtime's `triggers.ts` reads `_suspendMeta` to decide when to wake
-- suspended instances. Old rows that don't migrate will not resume on
-- timer/event tick (silent stall). The Tier A coverage check post-migration
-- is: `SELECT COUNT(*) FROM function_instances WHERE status IN
-- ('waiting_timer', 'waiting_event', 'awaiting_choice') AND NOT (variables
-- ? '_suspendMeta')` — expect 0.

BEGIN;

UPDATE function_instances
SET variables = (
  CASE
    -- Already migrated — idempotent
    WHEN variables ? '_suspendMeta' THEN variables
    -- WaitTimer + TelegramRetry
    WHEN (variables ? '_wakeAt') AND (variables ? '_telegramRetryReason') THEN
      (variables - '_wakeAt' - '_telegramRetryReason') ||
      jsonb_build_object('_suspendMeta', jsonb_build_object(
        '$tag', 'WaitTimer',
        'wakeAt', variables->'_wakeAt',
        'retryReason', jsonb_build_object(
          '$tag', 'Just',
          '_0', jsonb_build_object(
            '$tag', 'TelegramRetry',
            'description', variables->'_telegramRetryReason'
          )
        )
      ))
    -- WaitTimer + NotionRetry
    WHEN (variables ? '_wakeAt') AND (variables ? '_notionRetryReason') THEN
      (variables - '_wakeAt' - '_notionRetryReason') ||
      jsonb_build_object('_suspendMeta', jsonb_build_object(
        '$tag', 'WaitTimer',
        'wakeAt', variables->'_wakeAt',
        'retryReason', jsonb_build_object(
          '$tag', 'Just',
          '_0', jsonb_build_object(
            '$tag', 'NotionRetry',
            'description', variables->'_notionRetryReason'
          )
        )
      ))
    -- WaitTimer (no retry reason)
    WHEN variables ? '_wakeAt' THEN
      (variables - '_wakeAt') ||
      jsonb_build_object('_suspendMeta', jsonb_build_object(
        '$tag', 'WaitTimer',
        'wakeAt', variables->'_wakeAt',
        'retryReason', jsonb_build_object('$tag', 'Nothing')
      ))
    -- WaitEvent
    WHEN variables ? '_waitFilter' THEN
      (variables - '_waitFilter') ||
      jsonb_build_object('_suspendMeta', jsonb_build_object(
        '$tag', 'WaitEvent',
        'event', COALESCE(variables->'_waitFilter'->'event', '""'::jsonb),
        'filter', variables->'_waitFilter'
      ))
    -- AwaitingChoice
    WHEN variables ? '_readSchema' THEN
      (variables - '_readSchema') ||
      jsonb_build_object('_suspendMeta', jsonb_build_object(
        '$tag', 'AwaitingChoice',
        'schema', variables->'_readSchema'
      ))
    ELSE variables
  END
)
WHERE (variables ? '_waitFilter')
   OR (variables ? '_readSchema')
   OR (variables ? '_wakeAt');

COMMIT;
