CREATE TYPE "public"."enforce_type" AS ENUM('soft', 'hard');--> statement-breakpoint
CREATE TYPE "public"."flow_instance_status" AS ENUM('running', 'waiting_timer', 'waiting_event', 'awaiting_choice', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('digital_file', 'telegram_group_access', 'telegram_group_dynamic', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."payment_step_status" AS ENUM('pending', 'paid', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platform_type" AS ENUM('email', 'phone', 'instagram', 'telegram', 'discord', 'twitter');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'active', 'completed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_policy" AS ENUM('revoke_and_kick', 'manual');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"aggregate_type" text,
	"aggregate_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_handles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" "platform_type" NOT NULL,
	"handle" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text,
	"phone" text,
	"custom_data" jsonb DEFAULT '{}'::jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "item_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"item_id" uuid,
	"amount" integer,
	"currency" text DEFAULT 'USD',
	"duration" text,
	"providers" jsonb DEFAULT '[]'::jsonb,
	"on_refund" "refund_policy" DEFAULT 'manual' NOT NULL,
	"grants" jsonb DEFAULT '[]'::jsonb,
	"steps" jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"step_slug" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"status" "payment_step_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements_granted" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"entitlement_slug" text NOT NULL,
	"item_id" uuid,
	"granted_by_purchase_id" uuid,
	"granted_by_step" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"capacity" integer NOT NULL,
	"enforce" "enforce_type" DEFAULT 'soft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"entitlement_id" uuid,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "flow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_definition_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" "flow_instance_status" DEFAULT 'running' NOT NULL,
	"current_step_path" text,
	"variables" jsonb DEFAULT '{}'::jsonb,
	"trigger_event" jsonb,
	"parent_instance_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"on_submit" jsonb DEFAULT '[]'::jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_handles" ADD CONSTRAINT "lead_handles_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_handles" ADD CONSTRAINT "lead_handles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_steps" ADD CONSTRAINT "payment_steps_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements_granted" ADD CONSTRAINT "entitlements_granted_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements_granted" ADD CONSTRAINT "entitlements_granted_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements_granted" ADD CONSTRAINT "entitlements_granted_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements_granted" ADD CONSTRAINT "entitlements_granted_granted_by_purchase_id_purchases_id_fk" FOREIGN KEY ("granted_by_purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_inventory_id_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_entitlement_id_entitlements_granted_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements_granted"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_definitions" ADD CONSTRAINT "flow_definitions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_instances" ADD CONSTRAINT "flow_instances_flow_definition_id_flow_definitions_id_fk" FOREIGN KEY ("flow_definition_id") REFERENCES "public"."flow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_instances" ADD CONSTRAINT "flow_instances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_instances" ADD CONSTRAINT "flow_instances_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_form_definitions_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_account_type_idx" ON "events" USING btree ("account_id","type");--> statement-breakpoint
CREATE INDEX "events_account_lead_idx" ON "events" USING btree ("account_id","lead_id");--> statement-breakpoint
CREATE INDEX "events_account_aggregate_idx" ON "events" USING btree ("account_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_handles_account_platform_handle_idx" ON "lead_handles" USING btree ("account_id","platform","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "items_account_slug_idx" ON "items" USING btree ("account_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_account_slug_idx" ON "plans" USING btree ("account_id","slug");--> statement-breakpoint
CREATE INDEX "purchases_account_lead_idx" ON "purchases" USING btree ("account_id","lead_id");--> statement-breakpoint
CREATE INDEX "entitlements_account_lead_idx" ON "entitlements_granted" USING btree ("account_id","lead_id");--> statement-breakpoint
CREATE INDEX "entitlements_access_check_idx" ON "entitlements_granted" USING btree ("account_id","lead_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventories_account_slug_idx" ON "inventories" USING btree ("account_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_defs_account_slug_version_idx" ON "flow_definitions" USING btree ("account_id","slug","version");--> statement-breakpoint
CREATE INDEX "flow_instances_account_lead_idx" ON "flow_instances" USING btree ("account_id","lead_id");--> statement-breakpoint
CREATE INDEX "flow_instances_status_idx" ON "flow_instances" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "form_defs_account_slug_idx" ON "form_definitions" USING btree ("account_id","slug");--> statement-breakpoint
CREATE INDEX "form_submissions_lead_idx" ON "form_submissions" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_account_slug_idx" ON "channels" USING btree ("account_id","slug");