-- Pinned expressions may contain native Bytes and first-class Type values.
-- Existing views deliberately remain unmarked and are read as raw JSON.
ALTER TABLE locus_views ADD COLUMN IF NOT EXISTS view_encoding text;
ALTER TABLE locus_views ADD CONSTRAINT locus_views_value_encoding_supported
  CHECK (view_encoding IS NULL OR view_encoding = 'fenel-checkpoint-json-v1');
