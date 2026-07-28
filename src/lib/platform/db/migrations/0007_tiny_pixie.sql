CREATE TABLE IF NOT EXISTS "consent_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_type" varchar(50) NOT NULL,
	"consent_text" text NOT NULL,
	"product_version" varchar(20) NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "firm_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"access_level" varchar(20) DEFAULT 'read' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firm_not_own_client" CHECK ("firm_clients"."firm_org_id" != "firm_clients"."client_org_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "firm_clients" ADD CONSTRAINT "firm_clients_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "firm_clients" ADD CONSTRAINT "firm_clients_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consent_log_org" ON "consent_log" USING btree ("org_id","consented_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_consent_log_user" ON "consent_log" USING btree ("user_id","consented_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_firm_clients_pair" ON "firm_clients" USING btree ("firm_org_id","client_org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_firm_clients_client" ON "firm_clients" USING btree ("client_org_id");