import { randomUUID } from "node:crypto";
import { guidHash } from "@sparkle/core";
import * as schema from "@sparkle/db";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ALLOW_INSECURE_DEV_AUTH = "true";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/sparkle_test";

const { app } = await import("../src/app");
const { createLocalPool } = await import("@sparkle/db");

const DEV_USER = `http-user-${randomUUID().slice(0, 8)}`;
const H = { "X-Dev-User": DEV_USER };

describe.skipIf(!process.env.TEST_DATABASE_URL)("api v1 http surface", () => {
  let pool: ReturnType<typeof createLocalPool>;
  let db: NodePgDatabase<typeof schema>;
  let feedId = 0;
  const entryIds: number[] = [];

  beforeAll(async () => {
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error("TEST_DATABASE_URL required");
    pool = createLocalPool({ connectionString: testDbUrl });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP TABLE IF EXISTS read_later_items, user_media, media_objects, user_entries,
      subscriptions, feeds, categories, api_tokens, user_settings, users CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, {
      migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url)
        .pathname,
    });

    // identity + subscription + three entries
    await app.request("/api/v1/me", { headers: H });
    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    const userId = users[0]?.id;
    if (!userId) throw new Error("user row missing");

    await db.insert(schema.feeds).values({
      url: "https://api-test.example/rss.xml",
      title: "API Test Feed",
      siteUrl: "https://api-test.example",
    });
    feedId = (await db.select().from(schema.feeds)).at(0)?.id ?? -1;
    if (feedId === -1) throw new Error("feed row missing");
    await db.insert(schema.subscriptions).values({ userId, feedId });
    for (let i = 0; i < 3; i++) {
      const rows = await db
        .insert(schema.userEntries)
        .values({
          userId,
          feedId,
          guid: `g${i}`,
          guidHash: guidHash(`g${i}`),
          title: `Entry ${i}`,
          url: `https://api-test.example/${i}`,
          publishedAt: new Date(Date.UTC(2026, 0, i + 1)),
          enclosures: [],
        })
        .returning({ id: schema.userEntries.id });
      const entryId = rows.at(0)?.id;
      if (entryId === undefined) throw new Error("entry row missing");
      entryIds.push(entryId);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("exposes an open ping", async () => {
    const res = await app.request("/api/v1/ping");
    expect(res.status).toBe(200);
  });

  it("provisions and returns the caller identity", async () => {
    const res = await app.request("/api/v1/me", { headers: H });
    const body = (await res.json()) as { username: string };
    expect(res.status).toBe(200);
    expect(body.username).toBe(DEV_USER);
  });

  it("lists folders and manages them", async () => {
    const created = await app.request("/api/v1/folders", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HTTP Folder" }),
    });
    expect(created.status).toBe(201);
    const folder = ((await created.json()) as { folder: { id: string } })
      .folder;

    const dup = await app.request("/api/v1/folders", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HTTP Folder" }),
    });
    expect(dup.status).toBe(409);

    const renamed = await app.request(`/api/v1/folders/${folder.id}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(renamed.status).toBe(204);

    const deleted = await app.request(`/api/v1/folders/${folder.id}`, {
      method: "DELETE",
      headers: H,
    });
    expect(deleted.status).toBe(204);
    const missing = await app.request("/api/v1/folders/999999", {
      method: "DELETE",
      headers: H,
    });
    expect(missing.status).toBe(404);
  });

  it("lists subscriptions", async () => {
    const res = await app.request("/api/v1/subscriptions", { headers: H });
    const body = (await res.json()) as {
      subscriptions: Array<{ displayTitle: string }>;
    };
    expect(body.subscriptions[0]?.displayTitle).toBe("API Test Feed");
  });

  it("edits and removes a subscription", async () => {
    await db
      .insert(schema.feeds)
      .values({ url: "https://tmp.example/rss.xml", title: "Tmp" });
    const tmpFeed =
      (
        await db
          .select()
          .from(schema.feeds)
          .where(sql`url = 'https://tmp.example/rss.xml'`)
      ).at(0)?.id ?? -1;
    if (tmpFeed === -1) throw new Error("tmp feed missing");
    const userId = (await db.select().from(schema.users)).at(0)?.id;
    if (!userId) throw new Error("user row missing");
    await db.insert(schema.subscriptions).values({ userId, feedId: tmpFeed });

    const patched = await app.request(`/api/v1/subscriptions/${tmpFeed}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Custom Name" }),
    });
    const body = (await patched.json()) as {
      subscription: { displayTitle: string };
    };
    expect(body.subscription.displayTitle).toBe("Custom Name");

    const removed = await app.request(`/api/v1/subscriptions/${tmpFeed}`, {
      method: "DELETE",
      headers: H,
    });
    expect(removed.status).toBe(204);
  });

  it("paginates entries newest-first over http", async () => {
    const page1 = await app.request(
      `/api/v1/entries?limit=2&stream=feed:${feedId}`,
      {
        headers: H,
      },
    );
    const p1 = (await page1.json()) as {
      items: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(p1.items.map((e) => e.title)).toEqual(["Entry 2", "Entry 1"]);

    const page2 = await app.request(
      `/api/v1/entries?limit=2&stream=feed:${feedId}&cursor=${encodeURIComponent(p1.nextCursor ?? "")}`,
      { headers: H },
    );
    const p2 = (await page2.json()) as {
      items: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(p2.items.map((e) => e.title)).toEqual(["Entry 0"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("toggles read state and reports unread counts", async () => {
    const before = await app.request("/api/v1/unread-counts", { headers: H });
    const beforeBody = (await before.json()) as { total: number };
    expect(beforeBody.total).toBe(3);

    const marked = await app.request("/api/v1/entries/read", {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: entryIds.slice(0, 2), read: true }),
    });
    expect(((await marked.json()) as { updated: number }).updated).toBe(2);

    const after = await app.request("/api/v1/unread-counts", { headers: H });
    expect(((await after.json()) as { total: number }).total).toBe(1);

    const filter = await app.request(
      "/api/v1/entries?filter=unread&stream=all",
      { headers: H },
    );
    expect(((await filter.json()) as { items: unknown[] }).items).toHaveLength(
      1,
    );
  });

  it("stars entries and serves the starred stream", async () => {
    const starred = await app.request("/api/v1/entries/starred", {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [entryIds[0]], starred: true }),
    });
    expect(((await starred.json()) as { updated: number }).updated).toBe(1);

    const stream = await app.request("/api/v1/entries?stream=starred", {
      headers: H,
    });
    const body = (await stream.json()) as {
      items: Array<{ isStarred: boolean }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.isStarred).toBe(true);
  });

  it("marks a whole feed read", async () => {
    const res = await app.request("/api/v1/entries/mark-all-read", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ stream: `feed:${feedId}` }),
    });
    expect(((await res.json()) as { updated: number }).updated).toBeGreaterThan(
      0,
    );
    const counts = await app.request("/api/v1/unread-counts", { headers: H });
    expect(((await counts.json()) as { total: number }).total).toBe(0);
  });

  async function seedEntry(
    userId: string,
    guid: string,
    title: string,
    publishedAt: Date,
  ): Promise<number> {
    const rows = await db
      .insert(schema.userEntries)
      .values({
        userId,
        feedId,
        guid,
        guidHash: guidHash(guid),
        title,
        url: `https://api-test.example/${guid}`,
        publishedAt,
        enclosures: [],
      })
      .returning({ id: schema.userEntries.id });
    const id = rows.at(0)?.id;
    if (id === undefined) throw new Error("seed row missing");
    return id;
  }

  const devUserId = async (): Promise<string> => {
    const rows = await db
      .select()
      .from(schema.users)
      .where(sql`${schema.users.username} = ${DEV_USER}`);
    const id = rows.at(0)?.id;
    if (!id) throw new Error("user row missing");
    return id;
  };

  it("filters entry listings by published_at (pubFrom)", async () => {
    const userId = await devUserId();
    const seeded = [
      await seedEntry(userId, "pub-1", "Pub 1", new Date(Date.UTC(2026, 5, 1))),
      await seedEntry(userId, "pub-2", "Pub 2", new Date(Date.UTC(2026, 5, 2))),
      await seedEntry(userId, "pub-3", "Pub 3", new Date(Date.UTC(2026, 5, 3))),
    ];
    try {
      const res = await app.request(
        `/api/v1/entries?stream=feed:${feedId}&pubFrom=${encodeURIComponent(
          "2026-06-02T00:00:00.000Z",
        )}`,
        { headers: H },
      );
      const body = (await res.json()) as { items: Array<{ title: string }> };
      expect(res.status).toBe(200);
      expect(body.items.map((e) => e.title)).toEqual(["Pub 3", "Pub 2"]);

      const exact = await app.request(
        `/api/v1/entries?stream=feed:${feedId}&pubFrom=${encodeURIComponent(
          "2026-06-03T00:00:00.000Z",
        )}`,
        { headers: H },
      );
      const exactBody = (await exact.json()) as {
        items: Array<{ title: string }>;
      };
      expect(exactBody.items.map((e) => e.title)).toEqual(["Pub 3"]); // bound is inclusive
    } finally {
      await db
        .delete(schema.userEntries)
        .where(inArray(schema.userEntries.id, seeded));
    }
  });

  it("fetches a single entry by id", async () => {
    const userId = await devUserId();
    const mine = await seedEntry(
      userId,
      "single-1",
      "Single Entry",
      new Date(Date.UTC(2026, 5, 5)),
    );
    try {
      const res = await app.request(`/api/v1/entries/${mine}`, { headers: H });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        entry: { id: string; title: string };
      };
      expect(body.entry.id).toBe(String(mine));
      expect(body.entry.title).toBe("Single Entry");

      const missing = await app.request("/api/v1/entries/999999999", {
        headers: H,
      });
      expect(missing.status).toBe(404);

      const bad = await app.request("/api/v1/entries/not-a-number", {
        headers: H,
      });
      expect(bad.status).toBe(400);

      // another user's entry is invisible: 404 (not 403), no existence leak
      const other = await app.request(`/api/v1/entries/${mine}`, {
        headers: { "X-Dev-User": `other-${randomUUID().slice(0, 8)}` },
      });
      expect(other.status).toBe(404);
    } finally {
      await db
        .delete(schema.userEntries)
        .where(inArray(schema.userEntries.id, [mine]));
    }
  });

  it("exports opml with folders intact", async () => {
    await app.request("/api/v1/folders", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ExportFolder" }),
    });
    const res = await app.request("/api/v1/opml/export", { headers: H });
    const xml = await res.text();
    expect(res.headers.get("Content-Type")).toContain("xml");
    expect(xml).toContain('xmlUrl="https://api-test.example/rss.xml"');
    expect(xml).not.toContain("ExportFolder"); // no active subscription in that folder anymore
  });

  it("round-trips settings", async () => {
    await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { theme: "dark" } }),
    });
    const res = await app.request("/api/v1/settings", { headers: H });
    expect(((await res.json()) as { data: { theme: string } }).data.theme).toBe(
      "dark",
    );
  });

  it("mints and revokes api tokens", async () => {
    const minted = await app.request("/api/v1/me/api-tokens", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "nnw" }),
    });
    const body = (await minted.json()) as {
      token: string;
      record: { id: string };
    };
    expect(body.token.startsWith("srk_")).toBe(true);

    const list = await app.request("/api/v1/me/api-tokens", { headers: H });
    expect(((await list.json()) as { tokens: unknown[] }).tokens).toHaveLength(
      1,
    );

    const revoked = await app.request(
      `/api/v1/me/api-tokens/${body.record.id}`,
      {
        method: "DELETE",
        headers: H,
      },
    );
    expect(revoked.status).toBe(204);

    const empty = await app.request("/api/v1/me/api-tokens", { headers: H });
    expect(((await empty.json()) as { tokens: unknown[] }).tokens).toHaveLength(
      0,
    );
  });

  it("tracks read later for feed entries", async () => {
    const userId = await devUserId();
    const entryId = await seedEntry(
      userId,
      "rl-api-1",
      "Read Later Entry",
      new Date(Date.UTC(2026, 5, 6)),
    );
    const jsonHeaders = { ...H, "Content-Type": "application/json" };
    try {
      const saved = await app.request("/api/v1/read-later/entries", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ ids: [entryId], save: true }),
      });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { updated: number }).updated).toBe(1);

      // Entry payloads advertise the queue membership.
      const single = await app.request(`/api/v1/entries/${entryId}`, {
        headers: H,
      });
      const singleBody = (await single.json()) as {
        entry: { isReadLater: boolean };
      };
      expect(singleBody.entry.isReadLater).toBe(true);

      const list = await app.request("/api/v1/read-later", { headers: H });
      const page = (await list.json()) as {
        items: Array<{
          id: string;
          source: string;
          entryId: string | null;
          title: string;
          isRead: boolean;
          isStarred: boolean;
        }>;
        nextCursor: string | null;
      };
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        source: "entry",
        entryId: String(entryId),
        title: "Read Later Entry",
        isRead: false,
        isStarred: false,
      });
      expect(page.nextCursor).toBeNull();

      const counts = await app.request("/api/v1/read-later/count", {
        headers: H,
      });
      expect(await counts.json()).toEqual({ total: 1, unread: 1 });

      const itemId = page.items[0]?.id ?? "";
      const read = await app.request("/api/v1/read-later/read", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ ids: [itemId], read: true }),
      });
      expect(((await read.json()) as { updated: number }).updated).toBe(1);

      // Feed-sourced read state lands on the entry so both lists agree.
      const afterRead = await app.request(`/api/v1/entries/${entryId}`, {
        headers: H,
      });
      expect(
        ((await afterRead.json()) as { entry: { isRead: boolean } }).entry
          .isRead,
      ).toBe(true);
      expect(
        await (
          await app.request("/api/v1/read-later/count", { headers: H })
        ).json(),
      ).toEqual({ total: 1, unread: 0 });

      const removed = await app.request("/api/v1/read-later", {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({ ids: [itemId] }),
      });
      expect(((await removed.json()) as { removed: number }).removed).toBe(1);

      const empty = await app.request("/api/v1/read-later", { headers: H });
      expect(((await empty.json()) as { items: unknown[] }).items).toHaveLength(
        0,
      );
    } finally {
      await db
        .delete(schema.userEntries)
        .where(inArray(schema.userEntries.id, [entryId]));
    }
  });

  it("keeps read later items private to their owner", async () => {
    const userId = await devUserId();
    const entryId = await seedEntry(
      userId,
      "rl-api-2",
      "Private Entry",
      new Date(Date.UTC(2026, 5, 7)),
    );
    try {
      await app.request("/api/v1/read-later/entries", {
        method: "PATCH",
        headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [entryId], save: true }),
      });
      const other = { "X-Dev-User": `rl-other-${randomUUID().slice(0, 8)}` };
      const list = await app.request("/api/v1/read-later", { headers: other });
      expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(
        0,
      );
      const counts = await app.request("/api/v1/read-later/count", {
        headers: other,
      });
      expect(await counts.json()).toEqual({ total: 0, unread: 0 });
      // Another user cannot queue an entry they do not own either.
      const denied = await app.request("/api/v1/read-later/entries", {
        method: "PATCH",
        headers: { ...other, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [entryId], save: true }),
      });
      expect(((await denied.json()) as { updated: number }).updated).toBe(0);
    } finally {
      await db
        .delete(schema.readLaterItems)
        .where(eq(schema.readLaterItems.userId, userId));
      await db
        .delete(schema.userEntries)
        .where(inArray(schema.userEntries.id, [entryId]));
    }
  });

  it("rejects unsafe article urls and bad payloads", async () => {
    const jsonHeaders = { ...H, "Content-Type": "application/json" };
    // Loopback and friends are refused before any request is made.
    const loopback = await app.request("/api/v1/read-later", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ url: "http://127.0.0.1:8080/admin" }),
    });
    expect(loopback.status).toBe(400);

    const metadata = await app.request("/api/v1/read-later", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }),
    });
    expect(metadata.status).toBe(400);

    const scheme = await app.request("/api/v1/read-later", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    expect(scheme.status).toBe(400);

    const missing = await app.request("/api/v1/read-later", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    // Nothing was persisted by any of the rejected saves.
    const list = await app.request("/api/v1/read-later", { headers: H });
    const items = ((await list.json()) as { items: Array<{ url: string }> })
      .items;
    expect(items.map((item) => item.url)).toEqual([]);
  });

  it("validates read-later payloads with 400s", async () => {
    const badId = await app.request("/api/v1/read-later", {
      method: "DELETE",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["not-a-uuid"] }),
    });
    expect(badId.status).toBe(400);
    const badEntryIds = await app.request("/api/v1/read-later/entries", {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: "nope", save: true }),
    });
    expect(badEntryIds.status).toBe(400);
    const badCursor = await app.request("/api/v1/read-later?cursor=zzz", {
      headers: H,
    });
    expect(badCursor.status).toBe(400);
  });

  it("validates payloads with 400s", async () => {
    const bad = await app.request("/api/v1/entries/read", {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: "nope", read: true }),
    });
    expect(bad.status).toBe(400);
    const badStream = await app.request("/api/v1/entries?stream=bogus", {
      headers: H,
    });
    expect(badStream.status).toBe(400);
  });
});
