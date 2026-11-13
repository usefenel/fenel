-- Add `value_types` to traces — flat list of $named type references
-- reachable in the called function's params/returns. Powers the type
-- detail page's "Latest activity" panel and any future type-filtered
-- instance timeline. GIN-indexed for fast `@>` containment lookups.
--
-- Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS, plus index IF NOT EXISTS.

ALTER TABLE "traces" ADD COLUMN IF NOT EXISTS "value_types" jsonb;

CREATE INDEX IF NOT EXISTS "traces_value_types_idx" ON "traces" USING gin ("value_types");
