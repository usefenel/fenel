-- ---------------------------------------------------------------------------
-- Add `password_hash` to users. Format: `<saltHex>:<hashHex>`, scrypt.
-- Null for users without a password (dev-login bootstrap, invite pending, …).
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
