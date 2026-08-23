CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feeds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"url" text NOT NULL,
	"site_url" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_url" text DEFAULT '' NOT NULL,
	"etag" text,
	"last_modified" text,
	"ttl_minutes" bigint DEFAULT 60 NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"next_fetch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feeds_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" uuid NOT NULL,
	"feed_id" bigint NOT NULL,
	"category_id" bigint,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_feed_key" UNIQUE("user_id","feed_id")
);
--> statement-breakpoint
CREATE TABLE "user_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"feed_id" bigint NOT NULL,
	"guid" text NOT NULL,
	"guid_hash" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content_html" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"crawled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enclosures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"is_starred" boolean DEFAULT false NOT NULL,
	"starred_at" timestamp with time zone,
	CONSTRAINT "ue_dedupe_key" UNIQUE("feed_id","guid_hash","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cognito_sub" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_cognito_sub_unique" UNIQUE("cognito_sub"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "feeds_due_idx" ON "feeds" ("next_fetch_after");--> statement-breakpoint
CREATE INDEX "subscriptions_category_idx" ON "subscriptions" ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "ue_stream_idx" ON "user_entries" ("user_id","published_at","id");--> statement-breakpoint
CREATE INDEX "ue_feed_idx" ON "user_entries" ("user_id","feed_id","published_at","id");--> statement-breakpoint
CREATE INDEX "ue_unread_idx" ON "user_entries" ("user_id","is_read","feed_id","published_at");--> statement-breakpoint
CREATE INDEX "ue_starred_idx" ON "user_entries" ("user_id","is_starred","starred_at");