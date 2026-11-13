-- Migration 0003: leads→profiles refactoring + form type system + customData removal
--
-- This migration captures all schema changes since 0002:
-- 1. Rename leads → profiles, lead_handles → profile_handles, etc.
-- 2. Add profile fields: dob, avatar, notes, first_name, last_name
-- 3. Rename lead_tags → manual_profile_tags, add temporal fields
-- 4. Create profile_intents table
-- 5. Update FK columns: lead_id → profile_id across tables
-- 6. Form type system: scope on definitions, polymorphic submissions
-- 7. Remove custom_data from profiles
-- 8. Rename enums: lead_type → profile_type, lead_gender → profile_gender

-- ============================================================================
-- 1. Rename enums
-- ============================================================================

ALTER TYPE "lead_type" RENAME TO "profile_type";--> statement-breakpoint
ALTER TYPE "lead_gender" RENAME TO "profile_gender";--> statement-breakpoint

-- ============================================================================
-- 2. Rename tables
-- ============================================================================

ALTER TABLE "leads" RENAME TO "profiles";--> statement-breakpoint
ALTER TABLE "lead_handles" RENAME TO "profile_handles";--> statement-breakpoint
ALTER TABLE "lead_tags" RENAME TO "manual_profile_tags";--> statement-breakpoint
ALTER TABLE "lead_relationships" RENAME TO "profile_relationships";--> statement-breakpoint
ALTER TABLE "portfolio_leads" RENAME TO "portfolio_profiles";--> statement-breakpoint

-- ============================================================================
-- 3. Rename lead_id → profile_id columns
-- ============================================================================

ALTER TABLE "events" RENAME COLUMN "lead_id" TO "profile_id";--> statement-breakpoint
ALTER TABLE "entitlements_granted" RENAME COLUMN "lead_id" TO "profile_id";--> statement-breakpoint
ALTER TABLE "reservations" RENAME COLUMN "lead_id" TO "profile_id";--> statement-breakpoint
-- form_submissions.profile_id was already named profile_id in the original schema

-- Rename FK columns in renamed tables
ALTER TABLE "profile_handles" RENAME COLUMN "lead_id" TO "profile_id";--> statement-breakpoint
ALTER TABLE "manual_profile_tags" RENAME COLUMN "lead_id" TO "profile_id";--> statement-breakpoint
ALTER TABLE "profile_relationships" RENAME COLUMN "parent_lead_id" TO "profile_a_id";--> statement-breakpoint
ALTER TABLE "profile_relationships" RENAME COLUMN "child_lead_id" TO "profile_b_id";--> statement-breakpoint
ALTER TABLE "portfolio_profiles" RENAME COLUMN "lead_id" TO "profile_id";--> statement-breakpoint

-- ============================================================================
-- 4. Add profile fields
-- ============================================================================

ALTER TABLE "profiles" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_name" text;--> statement-breakpoint

-- ============================================================================
-- 5. Remove custom_data from profiles
-- ============================================================================

ALTER TABLE "profiles" DROP COLUMN IF EXISTS "custom_data";--> statement-breakpoint

-- ============================================================================
-- 6. Manual profile tags: add temporal + importance, drop source
-- ============================================================================

ALTER TABLE "manual_profile_tags" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "manual_profile_tags" ADD COLUMN "importance" real;--> statement-breakpoint
ALTER TABLE "manual_profile_tags" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "manual_profile_tags" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manual_profile_tags" DROP COLUMN IF EXISTS "source";--> statement-breakpoint
ALTER TABLE "manual_profile_tags" DROP COLUMN IF EXISTS "source_ref";--> statement-breakpoint

-- ============================================================================
-- 7. Create profile_intents table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "profile_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "item_id" uuid,
  "plan_id" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "profile_intents" ADD CONSTRAINT "profile_intents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_intents" ADD CONSTRAINT "profile_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_intents" ADD CONSTRAINT "profile_intents_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_intents" ADD CONSTRAINT "profile_intents_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_intents_profile_idx" ON "profile_intents" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_intents_account_idx" ON "profile_intents" USING btree ("account_id");--> statement-breakpoint

-- ============================================================================
-- 8. Add relationship columns (schema change from parent/child to symmetric A/B)
-- ============================================================================

ALTER TABLE "profile_relationships" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'member_of';--> statement-breakpoint
ALTER TABLE "profile_relationships" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint

-- ============================================================================
-- 9. Form definitions: add scope columns
-- ============================================================================

ALTER TABLE "form_definitions" ADD COLUMN "scope" text NOT NULL DEFAULT 'account';--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "scope_entity_type" text;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN "scope_entity_id" uuid;--> statement-breakpoint
CREATE INDEX "form_defs_scope_idx" ON "form_definitions" USING btree ("scope", "scope_entity_type", "scope_entity_id");--> statement-breakpoint

-- ============================================================================
-- 10. Form submissions: polymorphic attachment
-- ============================================================================

ALTER TABLE "form_submissions" ADD COLUMN "entity_type" text NOT NULL DEFAULT 'profile';--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "form_submissions" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "form_submissions_entity_idx" ON "form_submissions" USING btree ("entity_type", "entity_id");--> statement-breakpoint

-- ============================================================================
-- 11. Update indexes for renamed tables
-- ============================================================================

-- Drop old indexes if they exist (from leads era)
DROP INDEX IF EXISTS "lead_tags_account_tag_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_tags_lead_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_relationships_unique_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_relationships_parent_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "lead_relationships_child_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "portfolio_leads_unique_idx";--> statement-breakpoint

-- Create new indexes
CREATE UNIQUE INDEX IF NOT EXISTS "manual_profile_tags_unique_idx" ON "manual_profile_tags" USING btree ("profile_id", "tag", "context");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_profile_tags_account_tag_idx" ON "manual_profile_tags" USING btree ("account_id", "tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_profile_tags_valid_idx" ON "manual_profile_tags" USING btree ("profile_id", "valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profile_relationships_unique_idx" ON "profile_relationships" USING btree ("profile_a_id", "profile_b_id", "type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_relationships_a_idx" ON "profile_relationships" USING btree ("profile_a_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_relationships_b_idx" ON "profile_relationships" USING btree ("profile_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_profiles_unique_idx" ON "portfolio_profiles" USING btree ("portfolio_id", "profile_id");
