-- System identity linkage, not a table for a Fenel application type.
-- Workspace values remain ordinary typed data in the linked account.
BEGIN;
ALTER TABLE users ADD COLUMN personal_account_id uuid REFERENCES accounts(id);
CREATE UNIQUE INDEX users_personal_account_idx ON users(personal_account_id);
COMMIT;
