-- ---------------------------------------------------------------------------
-- Users — the human (or programmatic actor) behind a Subject.
-- One user may belong to multiple accounts via account_memberships.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- ---------------------------------------------------------------------------
-- Account memberships — which users belong to which accounts, with role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_memberships_user_account_idx
  ON account_memberships(user_id, account_id);

CREATE INDEX IF NOT EXISTS account_memberships_account_idx
  ON account_memberships(account_id);

-- ---------------------------------------------------------------------------
-- Sessions — opaque bearer tokens. tokenHash = sha256(rawToken).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL,
  label TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
