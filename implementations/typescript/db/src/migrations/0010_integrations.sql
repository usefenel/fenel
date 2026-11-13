-- Integration types enum
DO $$ BEGIN
  CREATE TYPE integration_type AS ENUM (
    'stripe',
    'nowpayments',
    'calendly',
    'telegram_bot',
    'webhook',
    'email_smtp'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Integration status enum
DO $$ BEGIN
  CREATE TYPE integration_status AS ENUM (
    'active',
    'failing',
    'expired',
    'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Integrations table
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  type integration_type NOT NULL,
  label TEXT,
  credentials JSONB NOT NULL DEFAULT '{}',
  config JSONB DEFAULT '{}',
  status integration_status NOT NULL DEFAULT 'active',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integrations_account_type_idx ON integrations(account_id, type);
