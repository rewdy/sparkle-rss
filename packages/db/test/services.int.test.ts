import { randomUUID } from "node:crypto";
import {
  createApiTokensService,
  createEntriesService,
  createFoldersService,
  createIngestService,
  createOpmlService,
  createSettingsService,
  createSubscriptionsService,
  createUsersService,
  guidHash,
} from "@sparkle/core";
import * as schema from "@sparkle/db";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalPool } from "../src/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
type Db = NodePgDatabase<typeof schema>;

describe.skipIf(!databaseUrl)("core services (docker Postgres)", () => {
  let pool: ReturnType<typeof createLocalPool>;
  let db: Db;
  const userId = randomUUID();

  async function seedEntry(
    feedId: number,
    guid: string,
    publishedAt: Date,
    overrides: Partial<typeof schema.userEntries.$inferInsert> = {},
  ): Promise<number> {
    const rows = await db
      .insert(schema.userEntries)
      .values({
        userId,
        feedId,
        guid,
        guidHash: guidHash(guid),
        title: `t-${guid}`,
        contentHtml: "<p>x</p>",
        publishedAt,
        enclosures: [],
        ...overrides,
      })
      .returning({ id: schema.userEntries.id });
    const seededId = rows.at(0)?.id;
    if (seededId === undefined) throw new Error("seed row missing");
    return seededId;
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("unreachable");
    pool = createLocalPool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP TABLE IF EXISTS user_media, media_objects, user_entries,
      subscriptions, feeds, categories, api_tokens, user_settings, users CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
    await db
      .insert(schema.users)
      .values({ id: userId, cognitoSub: "svc-sub", username: "svcuser" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  let folders: ReturnType<typeof createFoldersService>;
  let subs: ReturnType<typeof createSubscriptionsService>;
  let entries: ReturnType<typeof createEntriesService>;
  let settings: ReturnType<typeof createSettingsService>;
  let tokens: ReturnType<typeof createApiTokensService>;
  let users: ReturnType<typeof createUsersService>;
  let opml: ReturnType<typeof createOpmlService>;
  let ingest: ReturnType<typeof createIngestService>;

  beforeAll(() => {
    folders = createFoldersService({ db });
    subs = createSubscriptionsService({ db });
    entries = createEntriesService({ db });
    settings = createSettingsService({ db });
    tokens = createApiTokensService({ db });
    users = createUsersService({ db });
    opml = createOpmlService({ db });
    ingest = createIngestService({ db });
  });

  describe("folders", () => {
    it("creates, lists with counts, renames, deletes", async () => {
      const created = await folders.create(userId, "Tech");
      expect(created.feedCount).toBe(0);

      await expect(folders.create(userId, "Tech")).rejects.toMatchObject({
        status: 409,
      });

      await subs.subscribeDirect(userId, "https://example.com/f.xml", {
        categoryId: Number(created.id),
      });

      await folders.rename(userId, Number(created.id), "Technology");
      const listed = await folders.list(userId);
      expect(listed[0]).toMatchObject({ name: "Technology", feedCount: 1 });

      // delete detaches the subscription instead of cascading (no FKs)
      await folders.delete(userId, Number(created.id));
      expect(await folders.list(userId)).toHaveLength(0);
      const remaining = await subs.list(userId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.categoryId).toBeNull();
    });
  });

  describe("subscriptions", () => {
    it("subscribes via discovery, de-dupes feeds, rejects duplicates", async () => {
      const feedXml =
        '<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title></channel></rss>';
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/")) {
          return new Response(
            `<html><link rel="alternate" type="application/rss+xml" href="feed.xml"></html>`,
            {
              status: 200,
            },
          );
        }
        return new Response(feedXml, { status: 200 });
      }) as unknown as typeof fetch;

      const result = await subs.subscribe(userId, "https://example.org/", {
        fetch: fetchImpl as never,
      });
      expect(result.subscription.displayTitle).toBe("Example");

      await expect(
        subs.subscribe(userId, "https://example.org/", {
          fetch: fetchImpl as never,
        }),
      ).rejects.toMatchObject({ status: 409 });

      const list = await subs.list(userId);
      expect(
        list.find((s) => s.feedId === result.subscription.feedId)?.url,
      ).toBe("https://example.org/feed.xml");
    });

    it("invokes onSubscribed once on fresh subscribes, never on duplicates", async () => {
      const feedXml =
        '<?xml version="1.0"?><rss version="2.0"><channel><title>Hooked</title></channel></rss>';
      const fetchImpl = (async (url: string) => {
        if (String(url).endsWith("/")) {
          return new Response(
            `<html><link rel="alternate" type="application/rss+xml" href="feed.xml"></html>`,
            {
              status: 200,
            },
          );
        }
        return new Response(feedXml, { status: 200 });
      }) as unknown as typeof fetch;

      const calls: number[] = [];
      const hooked = createSubscriptionsService(
        { db },
        {
          onSubscribed: (feedId) => calls.push(feedId),
        },
      );

      const result = await hooked.subscribe(userId, "https://hook.example/", {
        fetch: fetchImpl as never,
      });
      expect(calls).toEqual([Number(result.subscription.feedId)]);

      await expect(
        hooked.subscribe(userId, "https://hook.example/", {
          fetch: fetchImpl as never,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(calls).toHaveLength(1); // 409 path must not re-trigger the hook

      const directCalls: number[] = [];
      const direct = createSubscriptionsService(
        { db },
        {
          onSubscribed: (feedId) => directCalls.push(feedId),
        },
      );
      const dto = await direct.subscribeDirect(
        userId,
        "https://hook2.example/rss.xml",
        {},
      );
      expect(directCalls).toEqual([Number(dto.feedId)]);

      await direct.subscribeDirect(userId, "https://hook2.example/rss.xml", {});
      expect(directCalls).toHaveLength(1); // existing subscription, nothing inserted
    });

    it("unsubscribes and removes that user’s entries", async () => {
      const created = await subs.subscribeDirect(
        userId,
        "https://gone.example/rss.xml",
        {},
      );
      const feedId = Number(created.feedId);
      await seedEntry(feedId, "g-one", new Date());
      await subs.unsubscribe(userId, feedId);
      const counts = await entries.unreadCountsByFeed(userId);
      expect(counts.has(feedId)).toBe(false);
      const orphaned = await db
        .select({ orphanedAt: schema.feeds.orphanedAt })
        .from(schema.feeds)
        .where(sql`${schema.feeds.id} = ${feedId}`);
      expect(orphaned[0]?.orphanedAt).toBeInstanceOf(Date);
      expect((await ingest.getDueFeeds(100)).some((f) => f.id === feedId)).toBe(
        false,
      );
      await expect(subs.unsubscribe(userId, feedId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("revives an orphaned feed on resubscribe and cleans old orphans", async () => {
      const revived = await subs.subscribeDirect(
        userId,
        "https://revive.example/rss.xml",
        {},
      );
      const revivedId = Number(revived.feedId);
      await subs.unsubscribe(userId, revivedId);
      await subs.subscribeDirect(userId, "https://revive.example/rss.xml", {});
      const active = await db
        .select({ orphanedAt: schema.feeds.orphanedAt })
        .from(schema.feeds)
        .where(sql`${schema.feeds.id} = ${revivedId}`);
      expect(active[0]?.orphanedAt).toBeNull();
      await subs.unsubscribe(userId, revivedId);

      await db
        .update(schema.feeds)
        .set({ orphanedAt: new Date(0) })
        .where(sql`${schema.feeds.id} = ${revivedId}`);
      expect(await ingest.cleanupOrphanedFeeds()).toBe(1);
      expect(
        await db
          .select({ id: schema.feeds.id })
          .from(schema.feeds)
          .where(sql`${schema.feeds.id} = ${revivedId}`),
      ).toHaveLength(0);
    });

    it("edits title and folder", async () => {
      const folders = createFoldersService({ db });
      const folder = await folders.create(userId, "EditFolder");
      const created = await subs.subscribeDirect(
        userId,
        "https://edit.example/rss.xml",
        {},
      );
      const edited = await subs.edit(userId, Number(created.feedId), {
        title: "My Title",
        categoryId: Number(folder.id),
      });
      expect(edited.displayTitle).toBe("My Title");
      expect(edited.categoryName).toBe("EditFolder");
      await folders.delete(userId, Number(folder.id));
    });
  });

  describe("entries: pagination, filters, bulk ops", () => {
    let feedA = 0;
    let feedB = 0;

    beforeAll(async () => {
      const a = await subs.subscribeDirect(
        userId,
        "https://a.example/rss.xml",
        {},
      );
      const b = await subs.subscribeDirect(
        userId,
        "https://b.example/rss.xml",
        {},
      );
      feedA = Number(a.feedId);
      feedB = Number(b.feedId);
      for (let i = 0; i < 5; i++) {
        await seedEntry(feedA, `a-${i}`, new Date(Date.UTC(2026, 0, i + 1)));
      }
      await seedEntry(feedB, "b-0", new Date(Date.UTC(2026, 0, 3)));
    });

    it("paginates newest-first with opaque cursors", async () => {
      const page1 = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        limit: 2,
      });
      expect(page1.items.map((e) => e.title)).toEqual(["t-a-4", "t-a-3"]);
      expect(page1.nextCursor).toBeTruthy();

      const page2 = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
      });
      expect(page2.items.map((e) => e.title)).toEqual(["t-a-2", "t-a-1"]);

      const page3 = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        limit: 2,
        cursor: page2.nextCursor ?? undefined,
      });
      expect(page3.items.map((e) => e.title)).toEqual(["t-a-0"]);
      expect(page3.nextCursor).toBeNull();
    });

    it("supports ascending order and rejects mismatched cursors", async () => {
      const asc = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        order: "asc",
        limit: 50,
      });
      expect(asc.items[0]?.title).toBe("t-a-0");

      const descPage = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        limit: 1,
      });
      await expect(
        entries.list(userId, {
          stream: { type: "feed", feedId: feedA },
          order: "asc",
          cursor: descPage.nextCursor ?? "",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("scopes folder streams to member feeds", async () => {
      const folders = createFoldersService({ db });
      const folder = await folders.create(userId, "PaginationFolder");
      const categoryId = Number(folder.id);
      await db
        .update(schema.subscriptions)
        .set({ categoryId })
        .where(
          sql`${schema.subscriptions.userId} = ${userId} and ${schema.subscriptions.feedId} = ${feedB}`,
        );

      const page = await entries.list(userId, {
        stream: { type: "folder", categoryId },
      });
      expect(page.items.map((e) => e.title)).toEqual(["t-b-0"]);
      await folders.delete(userId, categoryId);
    });

    it("filters unread and computes unread counts", async () => {
      const before = await entries.unreadCountsByFeed(userId);
      expect(before.get(feedA)?.count).toBe(5);
      expect(before.get(feedB)?.count).toBe(1);

      const firstTwo = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        limit: 2,
      });
      await entries.setReadState(
        userId,
        firstTwo.items.map((e) => Number(e.id)),
        true,
      );

      const unreadOnly = await entries.list(userId, {
        stream: { type: "feed", feedId: feedA },
        unreadOnly: true,
      });
      expect(unreadOnly.items).toHaveLength(3);

      const after = await entries.unreadCountsByFeed(userId);
      expect(after.get(feedA)?.count).toBe(3);

      // unmark returns to unread state
      await entries.setReadState(
        userId,
        firstTwo.items.map((e) => Number(e.id)),
        false,
      );
      expect((await entries.unreadCountsByFeed(userId)).get(feedA)?.count).toBe(
        5,
      );
    });

    it("stars entries and serves the starred stream by starred_at", async () => {
      const some = await entries.list(userId, {
        stream: { type: "all" },
        limit: 2,
      });
      await entries.setStarred(
        userId,
        some.items.map((e) => Number(e.id)),
        true,
      );
      const starred = await entries.list(userId, {
        stream: { type: "starred" },
        limit: 10,
      });
      expect(starred.items).toHaveLength(2);
      expect(starred.items.every((e) => e.isStarred)).toBe(true);
      expect(starred.nextCursor).toBeNull();
    });

    it("mark-all-read respects stream scope and time bound", async () => {
      const updated = await entries.markAllRead(
        userId,
        { type: "feed", feedId: feedB },
        new Date(),
      );
      expect(updated).toBe(1);
      expect(
        (await entries.unreadCountsByFeed(userId)).get(feedB),
      ).toBeUndefined();

      const future = new Date(Date.UTC(2026, 0, 2));
      const bounded = await entries.markAllRead(
        userId,
        { type: "all" },
        future,
      );
      expect(bounded).toBeGreaterThan(0);
      const remaining = await entries.unreadCountsByFeed(userId);
      const totalLeft = [...remaining.values()].reduce(
        (s, v) => s + v.count,
        0,
      );
      expect(totalLeft).toBeGreaterThan(0);
    });

    it("hydrates items by ids", async () => {
      const page = await entries.list(userId, {
        stream: { type: "all" },
        limit: 3,
      });
      const ids = page.items.map((e) => Number(e.id));
      const hydrated = await entries.getByIds(userId, ids);
      expect(hydrated).toHaveLength(ids.length);
      expect(new Set(hydrated.map((h) => h.id))).toEqual(
        new Set(page.items.map((e) => e.id)),
      );
    });
  });

  describe("settings + tokens + users", () => {
    it("merges settings shallowly", async () => {
      await settings.merge(userId, { theme: "dark", density: "cozy" });
      const merged = await settings.merge(userId, { theme: "light" });
      expect(merged).toMatchObject({ theme: "light", density: "cozy" });
      expect(await settings.get(userId)).toMatchObject({ theme: "light" });
    });

    it("mints, verifies, revokes api tokens", async () => {
      const minted = await tokens.mint(userId, "nnw");
      expect(minted.token.startsWith("srk_")).toBe(true);
      expect(await tokens.verify(minted.token)).toBe(userId);
      await tokens.revoke(userId, minted.record.id);
      expect(await tokens.verify(minted.token)).toBeNull();
      expect(await tokens.list(userId)).toHaveLength(0);
    });

    it("provisions users keyed by cognito sub", async () => {
      const sub = randomUUID();
      const first = await users.ensureByCognitoSub(
        sub,
        "newuser",
        "n@example.com",
      );
      const second = await users.ensureByCognitoSub(
        sub,
        "newuser",
        "n@example.com",
      );
      expect(first.id).toBe(second.id);
      expect(second.username).toBe("newuser");
    });
  });

  describe("opml", () => {
    it("parses nested outlines", async () => {
      const xml = `<?xml version="1.0"?>
<opml version="2.0"><head><title>t</title></head><body>
  <outline text="News">
    <outline type="rss" text="Item A" xmlUrl="https://a.example/feed" htmlUrl="https://a.example"/>
  </outline>
  <outline type="rss" text="Loose" xmlUrl="https://loose.example/feed"/>
</body></opml>`;
      const items = await opml.parseImport(xml);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        folderName: "News",
        feedUrl: "https://a.example/feed",
      });
      expect(items[1]?.folderName).toBeNull();
    });

    it("round-trips export → import → export", async () => {
      await subs.subscribeDirect(userId, "https://rt.example/rss.xml", {
        title: "RT Feed",
      });
      const exported = await opml.exportOpml(userId, await subs.list(userId));
      expect(exported).toContain('xmlUrl="https://rt.example/rss.xml"');

      const parsed = await opml.parseImport(exported);
      expect(
        parsed.some((i) => i.feedUrl === "https://rt.example/rss.xml"),
      ).toBe(true);
    });

    it("imports into folders by name", async () => {
      const imported = await opml.ensureFolderByName(userId, "ImportedFolder");
      expect(Number(imported)).toBeGreaterThan(0);
      const again = await opml.ensureFolderByName(userId, "ImportedFolder");
      expect(again).toBe(imported);
    });
  });
});
