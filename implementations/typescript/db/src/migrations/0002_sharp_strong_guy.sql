CREATE TYPE "public"."lead_gender" AS ENUM('male', 'female', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('person', 'group');--> statement-breakpoint
CREATE TABLE "lead_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"parent_lead_id" uuid NOT NULL,
	"child_lead_id" uuid NOT NULL,
	"relationship_type" text DEFAULT 'member_of' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_handles" ADD COLUMN "suspected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_handles" ADD COLUMN "valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_handles" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "type" "lead_type" DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "gender" "lead_gender";--> statement-breakpoint
ALTER TABLE "lead_relationships" ADD CONSTRAINT "lead_relationships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_relationships" ADD CONSTRAINT "lead_relationships_parent_lead_id_leads_id_fk" FOREIGN KEY ("parent_lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_relationships" ADD CONSTRAINT "lead_relationships_child_lead_id_leads_id_fk" FOREIGN KEY ("child_lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_leads" ADD CONSTRAINT "portfolio_leads_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_leads" ADD CONSTRAINT "portfolio_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_relationships_unique_idx" ON "lead_relationships" USING btree ("parent_lead_id","child_lead_id");--> statement-breakpoint
CREATE INDEX "lead_relationships_parent_idx" ON "lead_relationships" USING btree ("parent_lead_id");--> statement-breakpoint
CREATE INDEX "lead_relationships_child_idx" ON "lead_relationships" USING btree ("child_lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_leads_unique_idx" ON "portfolio_leads" USING btree ("portfolio_id","lead_id");--> statement-breakpoint
CREATE INDEX "portfolios_account_idx" ON "portfolios" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "portfolios_parent_idx" ON "portfolios" USING btree ("parent_id");