CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"external_id" varchar(100) NOT NULL,
	"source_system" varchar(20) NOT NULL,
	"account_type" varchar(30) NOT NULL,
	"account_subtype" varchar(50),
	"name" varchar(255) NOT NULL,
	"description" text,
	"current_balance" numeric(15, 2),
	"currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"parent_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"external_id" varchar(100) NOT NULL,
	"source_system" varchar(20) NOT NULL,
	"transaction_date" date NOT NULL,
	"posted_date" date,
	"amount" numeric(15, 2) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"amount_base" numeric(15, 2),
	"transaction_type" varchar(30) NOT NULL,
	"category" varchar(50),
	"subcategory" varchar(50),
	"description" text,
	"vendor_name" varchar(255),
	"account_id" uuid,
	"reference_number" varchar(100),
	"is_reconciled" boolean DEFAULT false NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_accounts_org_external" ON "accounts" USING btree ("org_id","source_system","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_accounts_org_type" ON "accounts" USING btree ("org_id","account_type") WHERE "accounts"."is_active" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_org_date" ON "transactions" USING btree ("org_id","transaction_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_org_category_date" ON "transactions" USING btree ("org_id","category","transaction_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_org_type_date" ON "transactions" USING btree ("org_id","transaction_type","transaction_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_org_account_date" ON "transactions" USING btree ("org_id","account_id","transaction_date" DESC NULLS LAST) WHERE "transactions"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_transactions_org_external" ON "transactions" USING btree ("org_id","source_system","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_transactions_org_vendor_date" ON "transactions" USING btree ("org_id","vendor_name","transaction_date" DESC NULLS LAST) WHERE "transactions"."vendor_name" IS NOT NULL;