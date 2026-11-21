CREATE TABLE "review_pace" (
	"track_id" bigint,
	"country" varchar(2),
	"per_day" real NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_pace_pkey" PRIMARY KEY("track_id","country")
);
--> statement-breakpoint
DROP INDEX "keywords_country_phrase_index";--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "platform" text DEFAULT 'ios' NOT NULL;--> statement-breakpoint
ALTER TABLE "brainstorms" ADD COLUMN "platform" text DEFAULT 'ios' NOT NULL;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "platform" text DEFAULT 'ios' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_platform_country_phrase_index" ON "keywords" ("platform","country","phrase");--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_platform_ck" CHECK ("platform" in ('ios', 'mac'));--> statement-breakpoint
ALTER TABLE "brainstorms" ADD CONSTRAINT "brainstorms_platform_ck" CHECK ("platform" in ('ios', 'mac'));--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_platform_ck" CHECK ("platform" in ('ios', 'mac'));