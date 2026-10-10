ALTER TABLE "user_media" ADD COLUMN "read_later_item_id" uuid;--> statement-breakpoint
ALTER TABLE "user_media" ADD COLUMN "source_identity" text;--> statement-breakpoint
ALTER TABLE "user_media" ADD COLUMN "dedupe_hash" text;--> statement-breakpoint
ALTER TABLE "user_media" ADD COLUMN "image_source_url" text;--> statement-breakpoint
ALTER TABLE "user_media" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_media" ADD COLUMN "source" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "user_media_saved_dedupe_key" ON "user_media" ("user_id","kind","dedupe_hash");--> statement-breakpoint
CREATE INDEX "user_media_saved_idx" ON "user_media" ("user_id","kind","saved_at","id");--> statement-breakpoint
CREATE INDEX "user_media_read_later_idx" ON "user_media" ("user_id","read_later_item_id");