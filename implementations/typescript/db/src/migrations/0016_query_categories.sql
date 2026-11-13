-- Query categories (hierarchical, replaces flat tags on saved_queries)
CREATE TABLE query_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES query_categories(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX query_categories_account_idx ON query_categories(account_id);
CREATE INDEX query_categories_parent_idx ON query_categories(parent_id);

-- Many-to-many: which queries belong to which categories
CREATE TABLE query_category_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES query_categories(id) ON DELETE CASCADE,
  query_id UUID NOT NULL REFERENCES saved_queries(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX qcm_category_idx ON query_category_members(category_id);
CREATE INDEX qcm_query_idx ON query_category_members(query_id);

-- Drop tags column from saved_queries
ALTER TABLE saved_queries DROP COLUMN IF EXISTS tags;
