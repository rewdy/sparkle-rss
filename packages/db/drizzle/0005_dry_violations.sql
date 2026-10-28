ALTER TABLE "user_entries" ADD COLUMN "full_content_html" text;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "full_content_url" text;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "full_content_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "content_attempt_token" uuid;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "content_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "content_failure" text;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "content_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_entries" ADD COLUMN "content_automatic_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "content_fetch_admissions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "content_fetch_version" integer DEFAULT 0 NOT NULL;