-- Home views — per-account customizable "OS" home page.
--
-- Each row is one desktop. `view` is a Fenel value of any layout-able type
-- (canvas, list, grid, tree). Exactly one row per account is `active` at a
-- time; that's the visible desktop at /dashboard/home. Switching desktops
-- = changing which row is active.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "home_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "view" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "home_views_account_idx" ON "home_views" ("account_id");
