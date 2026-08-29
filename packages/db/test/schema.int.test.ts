import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalPool } from "../src/client";
import * as schema from "../src/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("schema integration (docker Postgres)", () => {
  let pool: ReturnType<typeof createLocalPool>;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("unreachable");
    pool = createLocalPool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP TABLE IF EXISTS user_entries, subscriptions, feeds, categories,
      api_tokens, user_settings, users CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies migrations and supports the core write path", async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });

    const userId = randomUUID();
    await db
      .insert(schema.users)
      .values({ id: userId, cognitoSub: "sub-1", username: "alice" });

    await db
      .insert(schema.feeds)
      .values({ url: "https://example.com/feed.xml", title: "Example" });
    const feedRows = await db.select().from(schema.feeds);
    const feedId = feedRows[0]?.id;
    if (!feedId) throw new Error("feed insert failed");

    await db.insert(schema.subscriptions).values({ userId, feedId });
    const guidHash =
      "5f1b3d2a4c6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8";
    await db.insert(schema.userEntries).values({
      userId,
      feedId,
      guid: "https://example.com/post-1",
      guidHash,
      title: "Post",
      publishedAt: new Date(),
    });
    const duplicate = db
      .insert(schema.userEntries)
      .values({
        userId,
        feedId,
        guid: "https://example.com/post-1",
        guidHash,
        title: "Post dup",
        publishedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.userEntries.id });
    await expect(duplicate).resolves.toEqual([]);

    const entries = await db.select().from(schema.userEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.isRead).toBe(false);

    await db.execute(sql`SELECT gen_random_uuid()`);
  });

  it("enforces unique category names per user", async () => {
    const userId = randomUUID();
    await db
      .insert(schema.users)
      .values({ id: userId, cognitoSub: "sub-2", username: "bob" });
    await db.insert(schema.categories).values({ userId, name: "Tech" });
    await expect(
      db.insert(schema.categories).values({ userId, name: "Tech" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "categories_user_name_key" },
    });
    const otherUser = randomUUID();
    await db
      .insert(schema.users)
      .values({ id: otherUser, cognitoSub: "sub-3", username: "carol" });
    await expect(
      db.insert(schema.categories).values({ userId: otherUser, name: "Tech" }),
    ).resolves.toBeTruthy();
  });
});
