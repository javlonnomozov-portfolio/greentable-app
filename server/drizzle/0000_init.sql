CREATE TABLE "admin_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"install_id" text NOT NULL,
	"model" text,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"percent" integer,
	"amount" integer,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"benefit_months" integer,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"new_only" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hall_discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"hall_id" uuid NOT NULL,
	"discount_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hall_members" (
	"hall_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hall_members_hall_id_user_id_pk" PRIMARY KEY("hall_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" integer NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"paid_until" timestamp with time zone,
	"device_limit" integer,
	"data_epoch" integer DEFAULT 1 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"last_reminder" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"hall_id" uuid NOT NULL,
	"created_by" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" integer,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_requests" (
	"token" text PRIMARY KEY NOT NULL,
	"install_id" text NOT NULL,
	"model" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" integer,
	"hall_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"monthly_price" integer NOT NULL,
	"trial_days" integer NOT NULL,
	"grace_days" integer NOT NULL,
	"default_device_limit" integer NOT NULL,
	"payment_text" text DEFAULT '' NOT NULL,
	"support_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"hall_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"file_id" text NOT NULL,
	"file_kind" text NOT NULL,
	"mime_type" text,
	"caption" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" integer,
	"days_added" integer,
	"price_at_review" integer,
	"reject_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"hall_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"days" integer,
	"amount" integer,
	"from_date" timestamp with time zone,
	"to_date" timestamp with time zone,
	"receipt_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_rows" (
	"hall_id" uuid NOT NULL,
	"tbl" text NOT NULL,
	"uid" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"device_id" uuid,
	"rev" bigserial NOT NULL,
	CONSTRAINT "sync_rows_hall_id_tbl_uid_pk" PRIMARY KEY("hall_id","tbl","uid")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"first_name" text,
	"last_name" text,
	"username" text,
	"phone" text,
	"active_hall_id" uuid,
	"bot_state" jsonb,
	"trial_used_at" timestamp with time zone,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_discounts" ADD CONSTRAINT "hall_discounts_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_discounts" ADD CONSTRAINT "hall_discounts_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_members" ADD CONSTRAINT "hall_members_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_members" ADD CONSTRAINT "hall_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_requests" ADD CONSTRAINT "login_requests_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_rows" ADD CONSTRAINT "sync_rows_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_hall_idx" ON "devices" USING btree ("hall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discounts_code_idx" ON "discounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "hall_discounts_uniq" ON "hall_discounts" USING btree ("hall_id","discount_id");--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "subscription_events_hall_idx" ON "subscription_events" USING btree ("hall_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_rows_rev_idx" ON "sync_rows" USING btree ("hall_id","rev");