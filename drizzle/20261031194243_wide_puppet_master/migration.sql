CREATE TABLE "app_competitors" (
	"app_id" bigint,
	"competitor_id" bigint,
	CONSTRAINT "app_competitors_pkey" PRIMARY KEY("app_id","competitor_id"),
	CONSTRAINT "app_competitors_self_ck" CHECK ("app_id" <> "competitor_id")
);
--> statement-breakpoint
CREATE TABLE "app_keywords" (
	"app_id" bigint,
	"keyword_id" integer,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_keywords_pkey" PRIMARY KEY("app_id","keyword_id")
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"track_id" bigint PRIMARY KEY,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"is_mine" boolean DEFAULT false NOT NULL,
	"developer" text DEFAULT '' NOT NULL,
	"storefront" varchar(2) DEFAULT 'us' NOT NULL,
	"countries" varchar(2)[] DEFAULT '{}'::varchar(2)[] NOT NULL,
	"language" text DEFAULT 'en-US' NOT NULL,
	"schedule" text DEFAULT 'daily' NOT NULL,
	"listing" jsonb,
	"added_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_schedule_ck" CHECK ("schedule" in ('off', 'daily', 'weekly'))
);
--> statement-breakpoint
CREATE TABLE "brainstorms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "brainstorms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"idea" text NOT NULL,
	"countries" varchar(2)[] NOT NULL,
	"keyword_ids" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_worker" (
	"id" smallint PRIMARY KEY DEFAULT 1,
	"next_slot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_until" timestamp with time zone,
	"throttles" smallint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"last_throttled_at" timestamp with time zone,
	"worker_id" text,
	"lease_until" timestamp with time zone,
	CONSTRAINT "check_worker_single_ck" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "keyword_checks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "keyword_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"keyword_id" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"volume" smallint NOT NULL,
	"difficulty" smallint NOT NULL,
	"top_apps" jsonb NOT NULL,
	"app_id" bigint,
	"rank" smallint,
	CONSTRAINT "keyword_checks_volume_ck" CHECK ("volume" between 0 and 100),
	CONSTRAINT "keyword_checks_difficulty_ck" CHECK ("difficulty" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "keywords_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"phrase" text NOT NULL,
	"country" varchar(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"queue_priority" smallint DEFAULT 1 NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "keywords_country_ck" CHECK ("country" ~ '^[a-z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "term_phrases" (
	"term_id" integer,
	"country" varchar(2),
	"keyword_id" integer,
	"edited" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_phrases_pkey" PRIMARY KEY("term_id","country")
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "terms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"app_id" bigint NOT NULL,
	"label" text NOT NULL,
	"mode" text DEFAULT 'localized' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_mode_ck" CHECK ("mode" in ('localized', 'english', 'manual'))
);
--> statement-breakpoint
CREATE INDEX "keyword_checks_keyword_id_checked_at_index" ON "keyword_checks" ("keyword_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_country_phrase_index" ON "keywords" ("country","phrase");--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_id_country_index" ON "keywords" ("id","country");--> statement-breakpoint
CREATE INDEX "keywords_attempts_queue_priority_queued_at_index" ON "keywords" ("attempts","queue_priority","queued_at") WHERE "queued_at" is not null;--> statement-breakpoint
CREATE INDEX "term_phrases_keyword_id_index" ON "term_phrases" ("keyword_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_app_id_label_index" ON "terms" ("app_id","label");--> statement-breakpoint
ALTER TABLE "app_competitors" ADD CONSTRAINT "app_competitors_app_id_apps_track_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("track_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_competitors" ADD CONSTRAINT "app_competitors_competitor_id_apps_track_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "apps"("track_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_keywords" ADD CONSTRAINT "app_keywords_app_id_apps_track_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("track_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_keywords" ADD CONSTRAINT "app_keywords_keyword_id_keywords_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "keyword_checks" ADD CONSTRAINT "keyword_checks_keyword_id_keywords_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "term_phrases" ADD CONSTRAINT "term_phrases_term_id_terms_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "term_phrases" ADD CONSTRAINT "term_phrases_keyword_id_country_keywords_id_country_fkey" FOREIGN KEY ("keyword_id","country") REFERENCES "keywords"("id","country") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_app_id_apps_track_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("track_id") ON DELETE CASCADE;