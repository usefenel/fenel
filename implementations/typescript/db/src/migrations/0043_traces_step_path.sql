-- Add `step_path` to traces, plus a `let` value to span_kind.
--
-- step_path captures the position of a trace within the body's
-- expression tree (dotted frame-index path emitted by the runtime
-- evaluator's `turn()` loop). The function-editor's instance overlay
-- joins traces to expression nodes by this path.
--
-- The new `let` kind lets per-binding traces (one per let inside the
-- runtime, value = the bound value) coexist with the existing
-- call / read / wait / io / pure kinds without overloading them.
--
-- Idempotent.

ALTER TABLE "traces" ADD COLUMN IF NOT EXISTS "step_path" text;

DO $$
BEGIN
  -- Postgres < 12 doesn't support IF NOT EXISTS on ADD VALUE; this
  -- DO-block makes the migration safe to re-run on older versions too.
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'span_kind'::regtype
      AND enumlabel = 'let'
  ) THEN
    ALTER TYPE "span_kind" ADD VALUE 'let';
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "traces_step_path_idx"
  ON "traces" ("instance_id", "step_path");
