import { randomUUID } from "node:crypto";
import {
  createEntriesService,
  createIngestService,
  createMediaService,
  createReadLaterService,
  createSavedImagesService,
  createSavedLibraryService,
  createSubscriptionsService,
  guidHash,
} from "@sparkle/core";
import * as schema from "@sparkle/db";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createLocalPool } from "../src/client";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "saved images and mixed library",
  () => {
    let pool: ReturnType<typeof createLocalPool>,
      db: NodePgDatabase<typeof schema>;
    const owner = randomUUID(),
      other = randomUUID();
    const selected = {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      width: 100,
      height: 100,
      candidate: {
        url: "https://example.com/image.png",
        alt: "diagram",
        order: 0,
        source: "content" as const,
      },
    };
    const put = vi.fn(async () => {}),
      fetchImage = vi.fn(async () => selected);
    let images: ReturnType<typeof createSavedImagesService>,
      media: ReturnType<typeof createMediaService>,
      library: ReturnType<typeof createSavedLibraryService>;
    let entryId: number, feedId: number;
    const source = () => ({ kind: "entry" as const, id: String(entryId) });
    beforeAll(async () => {
      pool = createLocalPool({
        connectionString: process.env.TEST_DATABASE_URL ?? "",
      });
      db = drizzle(pool, { schema });
      await db.execute(
        sql`DROP TABLE IF EXISTS read_later_items,user_media,media_objects,user_entries,subscriptions,feeds,categories,api_tokens,user_settings,users CASCADE`,
      );
      await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db, {
        migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
      });
      media = createMediaService({ db, store: { put } });
      images = createSavedImagesService({ db, media, fetchImage });
      library = createSavedLibraryService({ db, images });
    });
    beforeEach(async () => {
      await db.execute(
        sql`TRUNCATE read_later_items,user_media,media_objects,user_entries,subscriptions,feeds,users`,
      );
      await db.insert(schema.users).values([
        { id: owner, cognitoSub: owner, username: owner },
        { id: other, cognitoSub: other, username: other },
      ]);
      feedId =
        (
          await db
            .insert(schema.feeds)
            .values({ url: "https://example.com/feed", title: "Feed" })
            .returning()
        )[0]?.id ?? 0;
      await db.insert(schema.subscriptions).values({ userId: owner, feedId });
      entryId =
        (
          await db
            .insert(schema.userEntries)
            .values({
              userId: owner,
              feedId,
              guid: "a",
              guidHash: guidHash("a"),
              title: "Article",
              url: "https://example.com/article",
              contentHtml:
                '<a href="/full"><img src="/image.png" alt="diagram"></a>',
              publishedAt: new Date(),
            })
            .returning()
        )[0]?.id ?? 0;
      vi.clearAllMocks();
    });
    afterAll(async () => {
      await pool?.end();
    });

    it("stores snapshots without starring and retains a single concurrent save", async () => {
      const [a, b] = await Promise.all([
        images.save(owner, source(), "/image.png"),
        images.save(owner, source(), "/image.png"),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.savedAtMs).toBe(b.savedAtMs);
      expect(a.source).toMatchObject({
        articleTitle: "Article",
        feedTitle: "Feed",
        feedUrl: "https://example.com/feed",
        available: true,
      });
      expect(await images.save(owner, source(), "/image.png")).toEqual(a);
      expect(
        (await createEntriesService({ db }).getByIds(owner, [entryId]))[0]
          ?.isStarred,
      ).toBe(false);
      expect(await db.select().from(schema.userMedia)).toHaveLength(1);
    });
    it("authorizes before fetching and refuses arbitrary image URLs", async () => {
      await expect(
        images.save(other, source(), "/image.png"),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        images.save(owner, source(), "https://example.com/not-in-article.png"),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchImage).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    });
    it("retains explicit saves after unsubscribe and orphan-feed cleanup", async () => {
      await media.attachSplash(owner, entryId, selected);
      const image = await images.save(owner, source(), "/image.png");
      expect(fetchImage).not.toHaveBeenCalled();
      await createSubscriptionsService({ db }).unsubscribe(owner, feedId);
      const retained = await images.get(owner, image.id);
      expect(retained.source.available).toBe(false);
      expect(retained.source.feedTitle).toBe("Feed");
      await db.update(schema.feeds).set({ orphanedAt: new Date(0) });
      await createIngestService({ db }).cleanupOrphanedFeeds();
      expect(await images.get(owner, image.id)).toMatchObject({ id: image.id });
      expect(await media.getForUser(owner, image.image.id)).not.toBeNull();
    });
    it("orphan-feed cleanup preserves explicit associations on residual entries", async () => {
      const image = await images.save(owner, source(), "/image.png");
      await db.delete(schema.subscriptions);
      await db.update(schema.feeds).set({ orphanedAt: new Date(0) });
      await createIngestService({ db }).cleanupOrphanedFeeds();
      expect((await images.get(owner, image.id)).source.available).toBe(false);
    });
    it("saves read-later URLs and survives removal", async () => {
      const later = createReadLaterService({ db });
      const item = await later.saveUrl(owner, {
        url: "https://example.com/off-feed",
        title: "URL article",
        contentHtml: '<img src="https://example.com/image.png">',
        siteName: "Site",
      });
      const image = await images.save(
        owner,
        { kind: "read-later", id: item.id },
        "/image.png",
      );
      await later.remove(owner, [item.id]);
      expect((await images.get(owner, image.id)).source).toMatchObject({
        kind: "read-later",
        articleTitle: "URL article",
        siteName: "Site",
        available: false,
      });
    });
    it("deduplicates a feed image across read-later and feed reader", async () => {
      const later = createReadLaterService({ db });
      await later.saveEntries(owner, [entryId], true);
      const item = (await later.list(owner)).items[0];
      if (!item) throw new Error("missing later item");
      const a = await images.save(owner, source(), "/image.png"),
        b = await images.save(
          owner,
          { kind: "read-later", id: item.id },
          "/image.png",
        );
      expect(a.id).toBe(b.id);
    });
    it("rejects foreign detail/removal/media and preserves shared associations", async () => {
      await media.attachSplash(owner, entryId, selected);
      const image = await images.save(owner, source(), "/image.png");
      await expect(images.get(other, image.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(images.remove(other, image.id)).rejects.toMatchObject({
        status: 404,
      });
      expect(await media.getForUser(other, image.image.id)).toBeNull();
      await images.remove(owner, image.id);
      await expect(images.get(owner, image.id)).rejects.toMatchObject({
        status: 404,
      });
      expect(await media.getForUser(owner, image.image.id)).not.toBeNull();
      const saved = await images.save(owner, source(), "/image.png");
      expect(saved.id).not.toBe(image.id);
    });
    it("does not create a saved association on upload failure and can retry", async () => {
      put.mockRejectedValueOnce(new Error("upload failed"));
      await expect(images.save(owner, source(), "/image.png")).rejects.toThrow(
        "upload failed",
      );
      expect(await db.select().from(schema.userMedia)).toHaveLength(0);
      expect(await images.save(owner, source(), "/image.png")).toBeTruthy();
    });
    it("permits null splash dedupe keys and enforces saved dedupe keys", async () => {
      const object = await media.persist(selected);
      await db.insert(schema.userMedia).values(
        [1, 2].map(() => ({
          id: randomUUID(),
          userId: owner,
          mediaObjectId: object.id,
          kind: "article_splash",
        })),
      );
      const image = await images.save(owner, source(), "/image.png");
      expect((await images.get(owner, image.id)).id).toBe(image.id);
      expect(await db.select().from(schema.userMedia)).toHaveLength(3);
    });
    it.each(["asc", "desc"] as const)(
      "pages mixed timestamp ties with full precision (%s)",
      async (sort) => {
        const image = await images.save(owner, source(), "/image.png");
        await db.execute(
          sql`UPDATE user_media SET saved_at = '2026-10-10 12:00:00.123456+00' WHERE id = ${image.id}`,
        );
        await db.execute(
          sql`UPDATE user_entries SET is_starred = true, starred_at = '2026-10-10 12:00:00.123456+00' WHERE id = ${entryId}`,
        );
        const second = (
          await db
            .insert(schema.userEntries)
            .values({
              userId: owner,
              feedId,
              guid: "b",
              guidHash: guidHash("b"),
              publishedAt: new Date(),
              isStarred: true,
              starredAt: new Date(),
            })
            .returning()
        )[0];
        if (!second) throw new Error("missing second entry");
        await db.execute(
          sql`UPDATE user_entries SET starred_at = '2026-10-10 12:00:00.123457+00' WHERE id = ${second.id}`,
        );
        await db.insert(schema.userEntries).values({
          userId: other,
          feedId,
          guid: "foreign",
          guidHash: guidHash("foreign"),
          publishedAt: new Date(),
          isStarred: true,
          starredAt: new Date(),
        });
        const collected: string[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 5; i++) {
          const page = await library.list(owner, { sort, limit: 1, cursor });
          collected.push(
            ...page.items.map((item) => `${item.kind}:${item.id}`),
          );
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        const expected = [
          `article:${entryId}`,
          `image:${image.id}`,
          `article:${second.id}`,
        ];
        expect(collected).toEqual(
          sort === "asc" ? expected : expected.reverse(),
        );
      },
    );
    it("rejects malformed and wrong-direction cursors", async () => {
      await images.save(owner, source(), "/image.png");
      await createEntriesService({ db }).setStarred(owner, [entryId], true);
      const page = await library.list(owner, { limit: 1 });
      await expect(
        library.list(owner, { cursor: page.nextCursor ?? "", sort: "asc" }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        library.list(owner, { cursor: "garbage" }),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
