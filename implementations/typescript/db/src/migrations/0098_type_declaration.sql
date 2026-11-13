-- Generic declarations belong to the existing system type owner row.
-- NULL preserves the behavior of legacy ground types; no data backfill.
ALTER TABLE public.types ADD COLUMN IF NOT EXISTS declaration jsonb;
