CREATE TABLE IF NOT EXISTS "financial_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"period_type" varchar(10) NOT NULL,
	"total_revenue" numeric(15, 2),
	"total_expenses" numeric(15, 2),
	"net_profit" numeric(15, 2),
	"cash_position" numeric(15, 2),
	"ar_balance" numeric(15, 2),
	"expense_by_category" jsonb,
	"revenue_by_category" jsonb,
	"prior_period_revenue" numeric(15, 2),
	"prior_period_expenses" numeric(15, 2),
	"sync_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_snapshots_org_period" ON "financial_snapshots" USING btree ("org_id","period_start","period_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snapshots_org_monthly" ON "financial_snapshots" USING btree ("org_id","period_start" DESC NULLS LAST) WHERE "financial_snapshots"."period_type" = 'month';