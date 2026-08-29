ALTER TABLE "feeds" ADD COLUMN "orphaned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "feeds_orphaned_idx" ON "feeds" ("orphaned_at");
