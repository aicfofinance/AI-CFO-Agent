CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255),
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"model_used" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"response_time_ms" integer,
	"was_cached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "query_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" uuid,
	"success" boolean NOT NULL,
	"failure_reason" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"response_time_ms" integer,
	"model_used" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "query_log" ADD CONSTRAINT "query_log_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_org_date" ON "conversations" USING btree ("org_id","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_user" ON "conversations" USING btree ("org_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_org_content" ON "messages" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_log_org_period" ON "query_log" USING btree ("org_id","created_at" DESC NULLS LAST) WHERE "query_log"."success" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_query_log_org_day" ON "query_log" USING btree ("org_id",(DATE("created_at")));