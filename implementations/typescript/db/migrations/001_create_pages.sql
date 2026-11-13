-- Create pages table
CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB DEFAULT '{}'::jsonb,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pages_account_slug_idx ON pages(account_id, slug);

-- Create page submissions table
CREATE TABLE IF NOT EXISTS page_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  block_index TEXT NOT NULL DEFAULT '0',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
