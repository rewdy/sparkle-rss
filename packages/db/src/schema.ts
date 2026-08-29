import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Aurora DSQL does not support FOREIGN KEY constraints (see docs/03-data-model.md):
// columns below are logically related but declared without .references().
// Referential integrity and cascade behavior live in packages/core repositories.

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  cognitoSub: text("cognito_sub").notNull().unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  email: text("email").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity({ cache: 1 })
      .primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    sortKey: text("sort_key").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("categories_user_name_key").on(t.userId, t.name)],
);

export const feeds = pgTable(
  "feeds",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity({ cache: 1 })
      .primaryKey(),
    url: text("url").notNull().unique(),
    siteUrl: text("site_url").notNull().default(""),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    iconUrl: text("icon_url").notNull().default(""),
    etag: text("etag"),
    lastModified: text("last_modified"),
    ttlMinutes: bigint("ttl_minutes", { mode: "number" }).notNull().default(60),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    nextFetchAfter: timestamp("next_fetch_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true }),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feeds_due_idx").on(t.nextFetchAfter),
    index("feeds_orphaned_idx").on(t.orphanedAt),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id").notNull(),
    feedId: bigint("feed_id", { mode: "number" }).notNull(),
    categoryId: bigint("category_id", { mode: "number" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("subscriptions_user_feed_key").on(t.userId, t.feedId),
    index("subscriptions_category_idx").on(t.userId, t.categoryId),
  ],
);

export const userEntries = pgTable(
  "user_entries",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity({ cache: 1 })
      .primaryKey(),
    userId: uuid("user_id").notNull(),
    feedId: bigint("feed_id", { mode: "number" }).notNull(),
    guid: text("guid").notNull(),
    guidHash: text("guid_hash").notNull(),
    title: text("title").notNull().default(""),
    contentHtml: text("content_html").notNull().default(""),
    url: text("url").notNull().default(""),
    author: text("author").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    crawledAt: timestamp("crawled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    enclosures: jsonb("enclosures").notNull().default(sql`'[]'::jsonb`),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    isStarred: boolean("is_starred").notNull().default(false),
    starredAt: timestamp("starred_at", { withTimezone: true }),
  },
  (t) => [
    unique("ue_dedupe_key").on(t.feedId, t.guidHash, t.userId),
    // No .desc() keys and no partial WHEREs: DSQL rejects both, and btree
    // backward scans serve ORDER BY … DESC equally well on both engines.
    index("ue_stream_idx").on(t.userId, t.publishedAt, t.id),
    index("ue_feed_idx").on(t.userId, t.feedId, t.publishedAt, t.id),
    index("ue_unread_idx").on(t.userId, t.isRead, t.feedId, t.publishedAt),
    index("ue_starred_idx").on(t.userId, t.isStarred, t.starredAt),
  ],
);

export const mediaObjects = pgTable("media_objects", {
  id: uuid("id").primaryKey(),
  objectKey: text("object_key").notNull().unique(),
  sha256: text("sha256").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  width: bigint("width", { mode: "number" }).notNull(),
  height: bigint("height", { mode: "number" }).notNull(),
  sourceUrl: text("source_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userMedia = pgTable(
  "user_media",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    mediaObjectId: uuid("media_object_id").notNull(),
    entryId: bigint("entry_id", { mode: "number" }),
    kind: text("kind").notNull(),
    alt: text("alt").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("user_media_user_entry_idx").on(t.userId, t.entryId),
    index("user_media_user_kind_idx").on(t.userId, t.kind),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id").primaryKey(),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
