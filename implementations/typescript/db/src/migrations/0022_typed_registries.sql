-- Migration: 0022_typed_registries
-- Phase 9.I.2 — additive: create per-account registry tables for the
-- three engine namespaces that were in-memory only:
--
--   views             → user-defined TypeView records
--   functions         → user-defined FenelFunction records
--   typeclass_instances → per-account typeclass-instance overrides
--
-- Each table is a thin wrapper: an `account_id` + a name (or class+args
-- for typeclass instances) + the full record as JSONB. This is the
-- storage tier; the runtime loaders that pull these into the
-- typeclassRegistry / template registry on request come later (the
-- tables are empty until a UI seeds them, so the engine behaves
-- identically until then).
--
-- All three are scoped per account. System / stdlib registrations
-- continue to live in code (systemEntities, builtinTemplates,
-- builtinFunctions, builtinInstances).

CREATE TABLE IF NOT EXISTS "views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "name" text NOT NULL,
  "view" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-->statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "views_account_name_idx" ON "views" ("account_id", "name");
-->statement-breakpoint

CREATE TABLE IF NOT EXISTS "functions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "name" text NOT NULL,
  "function" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-->statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "functions_account_name_idx" ON "functions" ("account_id", "name");
-->statement-breakpoint

CREATE TABLE IF NOT EXISTS "typeclass_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "class_name" text NOT NULL,
  "args" jsonb NOT NULL,
  "instance" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-->statement-breakpoint

CREATE INDEX IF NOT EXISTS "typeclass_instances_account_class_idx" ON "typeclass_instances" ("account_id", "class_name");
