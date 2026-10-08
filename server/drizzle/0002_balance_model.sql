CREATE TABLE "discount_targets" (
	"discount_id" integer NOT NULL,
	"hall_id" uuid NOT NULL,
	CONSTRAINT "discount_targets_discount_id_hall_id_pk" PRIMARY KEY("discount_id","hall_id")
);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "benefit_days" integer;--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "audience" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "halls" ADD COLUMN "balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "halls" ADD COLUMN "paid_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "halls" ADD COLUMN "debt_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD COLUMN "balance_after" integer;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE cascade ON UPDATE no action;