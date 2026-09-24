CREATE TABLE "read_later_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" bigint,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"site_name" text DEFAULT '' NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"content_html" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"dedupe_hash" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rl_dedupe_key" UNIQUE("user_id","dedupe_hash")
);
--> statement-breakpoint
CREATE INDEX "rl_user_saved_idx" ON "read_later_items" ("user_id","saved_at","id");--> statement-breakpoint
CREATE INDEX "rl_user_entry_idx" ON "read_later_items" ("user_id","entry_id");