-- Migration 0004: profile_phones table, nicknames column, ai_agent enum value
--
-- Schema additions since 0003:
-- 1. Add 'ai_agent' value to profile_type enum
-- 2. Add nicknames JSON column to profiles
-- 3. Create profile_phones table
-- 4. Create profile_intents indexes (were missing from 0003)

-- ============================================================================
-- 1. Add ai_agent to profile_type enum
-- ============================================================================

ALTER TYPE "profile_type" ADD VALUE IF NOT EXISTS 'ai_agent';--> statement-breakpoint

-- ============================================================================
-- 2. Add nicknames column to profiles
-- ============================================================================

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "nicknames" json;--> statement-breakpoint

-- ============================================================================
-- 3. Create profile_phones table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "profile_phones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "number" text NOT NULL,
  "label" text NOT NULL DEFAULT 'mobile',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_phones_profile_idx" ON "profile_phones" USING btree ("profile_id");--> statement-breakpoint

-- ============================================================================
-- 4. Profile intents indexes (ensure they exist)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "profile_intents_profile_idx" ON "profile_intents" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_intents_account_idx" ON "profile_intents" USING btree ("account_id");--> statement-breakpoint

-- ============================================================================
-- 5. Entity definitions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "entity_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "name" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "schema" json DEFAULT '[]'::json,
  "structure" text NOT NULL DEFAULT 'flat',
  "ref_label" text,
  "default_template" text,
  "is_system" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_defs_account_name_idx" ON "entity_definitions" USING btree ("account_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_defs_account_idx" ON "entity_definitions" USING btree ("account_id");
