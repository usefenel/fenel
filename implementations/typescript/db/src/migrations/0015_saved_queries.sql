CREATE TABLE saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  query JSONB NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX saved_queries_account_idx ON saved_queries(account_id);
CREATE INDEX saved_queries_slug_idx ON saved_queries(account_id, slug);
