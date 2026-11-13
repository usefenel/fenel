-- ---------------------------------------------------------------------------
-- Registries — published, version-pinned, immutable code artifacts.
-- Built-in registries (e.g. fenel/stdlib) have NULL owner_account_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  owner_account_id UUID REFERENCES accounts(id),
  source TEXT NOT NULL,
  module JSONB,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash TEXT NOT NULL,
  label TEXT,
  description TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS registries_slug_version_idx
  ON registries(slug, version);

CREATE INDEX IF NOT EXISTS registries_owner_idx
  ON registries(owner_account_id);

-- ---------------------------------------------------------------------------
-- Registry imports — per-account install pins. One row per (account, registry)
-- pair pinning a specific (slug, version).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  registry_id UUID NOT NULL REFERENCES registries(id),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS registry_imports_account_registry_idx
  ON registry_imports(account_id, registry_id);

CREATE INDEX IF NOT EXISTS registry_imports_account_idx
  ON registry_imports(account_id);

-- ---------------------------------------------------------------------------
-- Permission policies — set-algebra access control.
-- Four SetExpr fields define the slice of (subject × action × resource ×
-- predicate) the policy permits. Union-semantic across rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  description TEXT,
  subjects JSONB NOT NULL,
  actions JSONB NOT NULL,
  resources JSONB NOT NULL,
  predicate JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permission_policies_account_idx
  ON permission_policies(account_id);
