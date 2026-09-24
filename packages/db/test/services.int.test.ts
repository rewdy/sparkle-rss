import { randomUUID } from "node:crypto";
import {
  AppError,
  createApiTokensService,
  createEntriesService,
  createFoldersService,
  createIngestService,
  createOpmlService,
  createReadLaterService,
  createSettingsService,
  createSubscriptionsService,
  createUsersService,
  encodeCursor,
  guidHash,
} from "@sparkle/core";
import * as schema from "@sparkle/db";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    await db.execute(sql`DROP TABLE IF EXISTS read_later_items, user_media, media_objects, user_entries,
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
  let readLater: ReturnType<typeof createReadLaterService>;

  beforeAll(() => {
    folders = createFoldersService({ db });
    subs = createSubscriptionsService({ db });
    entries = createEntriesService({ db });
    settings = createSettingsService({ db });
    tokens = createApiTokensService({ db });
    users = createUsersService({ db });
    opml = createOpmlService({ db });
    ingest = createIngestService({ db });
    readLater = createReadLaterService({ db });
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

  describe("read later", () => {
    const otherUserId = randomUUID();

    beforeAll(async () => {
      await db.insert(schema.users).values({
        id: otherUserId,
        cognitoSub: `rl-sub-${otherUserId}`,
        username: `rl-${otherUserId.slice(0, 8)}`,
      });
    });

    it("saves and removes feed entries idempotently", async () => {
      const entryId = await seedEntry(
        9001,
        "rl-entry-1",
        new Date("2026-09-01T00:00:00Z"),
      );

      expect(await readLater.saveEntries(userId, [entryId], true)).toBe(1);
      // re-saving the same entry is a no-op, not a duplicate row
      expect(await readLater.saveEntries(userId, [entryId], true)).toBe(0);
      expect(await readLater.entryIdsInQueue(userId, [entryId])).toEqual(
        new Set([entryId]),
      );

      expect(await readLater.saveEntries(userId, [entryId], false)).toBe(1);
      expect((await readLater.entryIdsInQueue(userId, [entryId])).size).toBe(0);
    });

    it("carries entry content and read state into the item", async () => {
      const entryId = await seedEntry(
        9002,
        "rl-entry-2",
        new Date("2026-09-02T00:00:00Z"),
        { url: "https://example.com/from-feed", title: "from feed" },
      );
      await readLater.saveEntries(userId, [entryId], true);
      const items = (await readLater.list(userId, { limit: 200 })).items;
      const item = items.find((i) => i.entryId === entryId.toString());
      expect(item).toMatchObject({
        source: "entry",
        url: "https://example.com/from-feed",
        title: "from feed",
        contentHtml: "<p>x</p>",
        status: "ready",
      });

      // Entry-sourced read state lives on the entry so both lists agree.
      await readLater.setReadState(userId, [item?.id ?? ""], true);
      const [reloaded] = await readLater.getByIds(userId, [item?.id ?? ""]);
      expect(reloaded?.isRead).toBe(true);
      const [entry] = await entries.getByIds(userId, [entryId]);
      expect(entry?.isRead).toBe(true);
    });

    it("keeps items whose entry disappeared, without counting them unread", async () => {
      const entryId = await seedEntry(
        9003,
        "rl-entry-3",
        new Date("2026-09-03T00:00:00Z"),
        { url: "https://example.com/orphan", title: "orphan" },
      );
      await readLater.saveEntries(userId, [entryId], true);
      const saved = (await readLater.list(userId, { limit: 200 })).items.find(
        (i) => i.entryId === entryId.toString(),
      );
      expect(saved).toBeDefined();

      // Unsubscribing deletes the entry (no FK cascade reaches saved items).
      await db
        .delete(schema.userEntries)
        .where(eq(schema.userEntries.id, entryId));

      const [orphaned] = await readLater.getByIds(userId, [saved?.id ?? ""]);
      expect(orphaned).toMatchObject({
        source: "entry",
        status: "error",
        url: "https://example.com/orphan",
        title: "orphan",
        isRead: true,
      });
      expect(await readLater.remove(userId, [saved?.id ?? ""])).toBe(1);
    });

    it("stores off-feed articles, normalized and deduped", async () => {
      const first = await readLater.saveUrl(userId, {
        url: "https://Example.com/post?utm_source=news&b=2&a=1#section",
        title: "A post",
        contentHtml: "<p>hello</p>",
        imageUrl: "https://example.com/og.jpg",
      });
      expect(first).toMatchObject({
        source: "url",
        url: "https://example.com/post?a=1&b=2",
        status: "ready",
        isRead: false,
        imageUrl: "https://example.com/og.jpg",
      });

      const again = await readLater.saveUrl(userId, {
        url: "https://example.com/post?a=1&b=2",
        title: "A post (updated)",
      });
      expect(again.id).toBe(first.id);
      const urls = (await readLater.list(userId, { limit: 200 })).items.filter(
        (i) => i.source === "url",
      );
      expect(urls).toHaveLength(1);
      expect(urls[0]?.title).toBe("A post (updated)");

      await readLater.setReadState(userId, [first.id], true);
      const [read] = await readLater.getByIds(userId, [first.id]);
      expect(read?.isRead).toBe(true);
    });

    it("rejects non-http urls", async () => {
      await expect(
        readLater.saveUrl(userId, { url: "file:///etc/passwd" }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        readLater.saveUrl(userId, { url: "not a url" }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("pages newest-saved first with a keyset cursor", async () => {
      const saved: string[] = [];
      for (let i = 0; i < 5; i++) {
        const item = await readLater.saveUrl(userId, {
          url: `https://example.com/page-${i}`,
          title: `page ${i}`,
        });
        saved.push(item.id);
      }
      // Distinct, known save times: several saves can land in the same
      // millisecond, which would leave the tie-break (row id) deciding order.
      for (const [index, id] of saved.entries()) {
        await db
          .update(schema.readLaterItems)
          .set({ savedAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })
          .where(eq(schema.readLaterItems.id, id));
      }

      const all = (await readLater.list(userId, { limit: 200 })).items;
      const mine = all.filter((item) => saved.includes(item.id));
      expect(mine.map((item) => item.id)).toEqual([...saved].reverse());

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await readLater.list(userId, { limit: 2, cursor });
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toEqual(all.map((i) => i.id));
      expect(new Set(seen).size).toBe(seen.length);
      await expect(
        readLater.list(userId, { cursor: "not-a-cursor" }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("reports totals and unread counts", async () => {
      const counts = await readLater.count(userId);
      const items = (await readLater.list(userId, { limit: 200 })).items;
      expect(counts.total).toBe(items.length);
      expect(counts.unread).toBeLessThanOrEqual(counts.total);
    });

    it("scopes items to their owner", async () => {
      const item = await readLater.saveUrl(userId, {
        url: "https://example.com/private",
        title: "private",
      });
      expect(await readLater.getByIds(otherUserId, [item.id])).toHaveLength(0);
      expect(await readLater.remove(otherUserId, [item.id])).toBe(0);
      expect(await readLater.count(otherUserId)).toEqual({
        total: 0,
        unread: 0,
      });

      const entryId = await seedEntry(
        9004,
        "rl-entry-4",
        new Date("2026-09-04T00:00:00Z"),
      );
      expect(await readLater.saveEntries(otherUserId, [entryId], true)).toBe(0);
    });

    it("stores extracted article content from the injected fetcher", async () => {
      const fetcher = vi.fn(async (url: string) => ({
        url,
        title: "Extracted title",
        byline: "Ada",
        siteName: "Example Blog",
        excerpt: "A summary.",
        contentHtml: "<p>body</p>",
        imageUrl: "https://example.com/hero.png",
        publishedAt: new Date("2026-08-01T00:00:00Z"),
        extracted: true,
      }));
      const service = createReadLaterService({ db, articleFetcher: fetcher });

      const item = await service.saveUrlWithExtraction(userId, {
        url: "https://example.com/extracted",
        title: "Reader supplied title",
      });
      expect(fetcher).toHaveBeenCalledWith("https://example.com/extracted");
      expect(item).toMatchObject({
        source: "url",
        url: "https://example.com/extracted",
        // the reader's title wins over the scraped one
        title: "Reader supplied title",
        author: "Ada",
        siteName: "Example Blog",
        excerpt: "A summary.",
        contentHtml: "<p>body</p>",
        imageUrl: "https://example.com/hero.png",
        status: "ready",
      });
      expect(item.publishedAtMs).toBe(Date.UTC(2026, 7, 1));

      await service.remove(userId, [item.id]);
    });

    it("keeps the link when extraction fails but rejects a blocked address", async () => {
      const failing = createReadLaterService({
        db,
        articleFetcher: async () => {
          throw new AppError(502, "the site answered 500");
        },
      });
      const item = await failing.saveUrlWithExtraction(userId, {
        url: "https://example.com/down",
        title: "Down",
      });
      expect(item).toMatchObject({
        source: "url",
        status: "error",
        error: "the site answered 500",
        url: "https://example.com/down",
        title: "Down",
        contentHtml: "",
      });

      const blocked = createReadLaterService({
        db,
        articleFetcher: async () => {
          throw new AppError(400, "that address is not reachable from here");
        },
      });
      await expect(
        blocked.saveUrlWithExtraction(userId, { url: "http://127.0.0.1/x" }),
      ).rejects.toMatchObject({ status: 400 });

      await failing.remove(userId, [item.id]);
    });
  });

  // A cursor's tie-break branch is raw SQL, and drizzle does not wrap raw SQL
  // chunks. Both keyed lists therefore have to parenthesize it themselves, or
  // the `or` escapes the user-scope condition and pages in another user's rows.
  describe("keyset cursor isolation", () => {
    const otherUserId = randomUUID();

    beforeAll(async () => {
      await db.insert(schema.users).values({
        id: otherUserId,
        cognitoSub: `cursor-sub-${otherUserId}`,
        username: `cursor-${otherUserId.slice(0, 8)}`,
      });
    });

    it("never returns another user's saved items", async () => {
      const mine = await readLater.saveUrl(userId, {
        url: "https://example.com/cursor-mine",
        title: "cursor mine",
      });
      const foreignAt = new Date(mine.savedAtMs);
      const foreignId = randomUUID();
      await db.insert(schema.readLaterItems).values({
        id: foreignId,
        userId: otherUserId,
        url: "https://example.com/cursor-foreign",
        title: "cursor foreign",
        dedupeHash: `cursor-foreign-${foreignId}`,
        savedAt: foreignAt,
      });
      try {
        // Same saved_at as the foreign row, with a maximal row id: the tie-break
        // branch matches the foreign row if it is not parenthesized.
        const cursor = encodeCursor({
          sortKey: "saved",
          direction: "desc",
          primaryAtMs: foreignAt.getTime(),
          entryId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        });
        const page = await readLater.list(userId, { limit: 50, cursor });
        expect(page.items.map((item) => item.id)).toContain(mine.id);
        expect(page.items.map((item) => item.id)).not.toContain(foreignId);
      } finally {
        await db
          .delete(schema.readLaterItems)
          .where(inArray(schema.readLaterItems.id, [foreignId, mine.id]));
      }
    });

    it("never returns another user's entries", async () => {
      const publishedAt = new Date("2026-08-08T08:08:08Z");
      const mine = await seedEntry(9005, "cursor-mine", publishedAt);
      const foreign = await seedEntry(9006, "cursor-foreign", publishedAt, {
        userId: otherUserId,
        title: "foreign entry",
      });
      try {
        const cursor = encodeCursor({
          sortKey: "published",
          direction: "desc",
          primaryAtMs: publishedAt.getTime(),
          entryId: "999999999999999",
        });
        const page = await entries.list(userId, {
          stream: { type: "all" },
          limit: 50,
          cursor,
        });
        const ids = page.items.map((item) => item.id);
        expect(ids).toContain(String(mine));
        expect(ids).not.toContain(String(foreign));
      } finally {
        await db
          .delete(schema.userEntries)
          .where(inArray(schema.userEntries.id, [mine, foreign]));
      }
    });
  });
});
