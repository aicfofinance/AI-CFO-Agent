CREATE TABLE IF NOT EXISTS "alert_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"alert_type" varchar(30) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"threshold_value" numeric(7, 4) NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"alert_type" varchar(30) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"amount_before" numeric(15, 2),
	"amount_after" numeric(15, 2),
	"change_percent" numeric(7, 4),
	"threshold_value" numeric(7, 4),
	"related_account_id" uuid,
	"related_category" varchar(50),
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"suppressed_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_type" varchar(30) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone,
	"generation_attempted_at" timestamp with time zone,
	"generation_error" text,
	"content" jsonb,
	"plain_text_summary" text,
	"model_used" varchar(50),
	"tokens_used" integer,
	"generated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"stripe_customer_id" varchar(100),
	"stripe_subscription_id" varchar(100),
	"plan_tier" varchar(20) DEFAULT 'trial' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"queries_used_this_period" integer DEFAULT 0 NOT NULL,
	"queries_limit" integer DEFAULT 20 NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_configs" ADD CONSTRAINT "alert_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_related_account_id_accounts_id_fk" FOREIGN KEY ("related_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_alert_configs_org_type" ON "alert_configs" USING btree ("org_id","alert_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alerts_org_unread" ON "alerts" USING btree ("org_id","triggered_at" DESC NULLS LAST) WHERE "alerts"."acknowledged_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alerts_org_type_suppressed" ON "alerts" USING btree ("org_id","alert_type","suppressed_until") WHERE "alerts"."suppressed_until" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reports_org_date" ON "reports" USING btree ("org_id","period_start" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_reports_org_period_type" ON "reports" USING btree ("org_id","period_start","report_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscriptions_org" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_stripe_customer" ON "subscriptions" USING btree ("stripe_customer_id") WHERE "subscriptions"."stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_stripe_sub" ON "subscriptions" USING btree ("stripe_subscription_id") WHERE "subscriptions"."stripe_subscription_id" IS NOT NULL;