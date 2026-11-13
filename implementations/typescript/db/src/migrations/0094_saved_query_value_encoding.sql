ALTER TABLE saved_queries ADD COLUMN IF NOT EXISTS query_encoding text;
ALTER TABLE saved_queries ADD CONSTRAINT saved_queries_query_encoding_check
  CHECK (query_encoding IS NULL OR query_encoding = 'fenel-checkpoint-json-v1');
