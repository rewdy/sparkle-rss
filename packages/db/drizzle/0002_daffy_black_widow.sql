CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"width" bigint NOT NULL,
	"height" bigint NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_objects_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "media_objects_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "user_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"media_object_id" uuid NOT NULL,
	"entry_id" bigint,
	"kind" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_media_user_entry_idx" ON "user_media" ("user_id","entry_id");--> statement-breakpoint
CREATE INDEX "user_media_user_kind_idx" ON "user_media" ("user_id","kind");
