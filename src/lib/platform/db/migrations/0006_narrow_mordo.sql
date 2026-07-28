CREATE TABLE IF NOT EXISTS "action_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"action_type" varchar(30) NOT NULL,
	"draft_content" text NOT NULL,
	"recipient_email" varchar(255),
	"recipient_name" varchar(255),
	"subject_line" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"model_used" varchar(50),
	"tokens_used" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"copied_at" timestamp with time zone,
	"rejected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_flow_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"intelligence_run_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"projection_period_days" integer NOT NULL,
	"projected_data" jsonb NOT NULL,
	"confidence_level" varchar(10) NOT NULL,
	"model_used" varchar(50),
	"minimum_projected_balance" numeric(15, 2),
	"risk_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"intelligence_run_id" uuid NOT NULL,
	"finding_type" varchar(30) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"headline" varchar(120) NOT NULL,
	"detail" text NOT NULL,
	"recommended_action" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"related_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"dismiss_reason" varchar(30),
	"actioned_at" timestamp with time zone,
	CONSTRAINT "findings_headline_max_120" CHECK (length("findings"."headline") <= 120)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intelligence_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_type" varchar(20) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"findings_generated" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"model_used" varchar(50),
	"tokens_used" integer,
	"skipped_reason" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_drafts" ADD CONSTRAINT "action_drafts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_drafts" ADD CONSTRAINT "action_drafts_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_flow_projections" ADD CONSTRAINT "cash_flow_projections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_flow_projections" ADD CONSTRAINT "cash_flow_projections_intelligence_run_id_intelligence_runs_id_fk" FOREIGN KEY ("intelligence_run_id") REFERENCES "public"."intelligence_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "findings" ADD CONSTRAINT "findings_intelligence_run_id_intelligence_runs_id_fk" FOREIGN KEY ("intelligence_run_id") REFERENCES "public"."intelligence_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intelligence_runs" ADD CONSTRAINT "intelligence_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_drafts_finding" ON "action_drafts" USING btree ("finding_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_drafts_org" ON "action_drafts" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_drafts_status" ON "action_drafts" USING btree ("org_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cashflow_projections_org_period" ON "cash_flow_projections" USING btree ("org_id","projection_period_days","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cashflow_projections_risk" ON "cash_flow_projections" USING btree ("org_id","risk_date") WHERE "cash_flow_projections"."risk_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_findings_org_active" ON "findings" USING btree ("org_id","severity","created_at" DESC NULLS LAST) WHERE "findings"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_findings_org_all" ON "findings" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_findings_org_type" ON "findings" USING btree ("org_id","finding_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_findings_expiry" ON "findings" USING btree ("expires_at") WHERE "findings"."status" = 'active' AND "findings"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_intelligence_runs_org_date" ON "intelligence_runs" USING btree ("org_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_intelligence_runs_skipped" ON "intelligence_runs" USING btree ("org_id","skipped_reason") WHERE "intelligence_runs"."status" = 'skipped';