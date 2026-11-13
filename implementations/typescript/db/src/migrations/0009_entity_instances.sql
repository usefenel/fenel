CREATE TABLE IF NOT EXISTS entity_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  entity_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_instances_account_type_idx ON entity_instances(account_id, entity_type);
CREATE INDEX IF NOT EXISTS entity_instances_account_idx ON entity_instances(account_id);
