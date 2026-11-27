import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as schema from "@sparkle/db";
import { createLocalPool } from "@sparkle/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createArticleContentService,
  createEntriesService,
  createMediaService,
  createReadLaterService,
  createSavedImagesService,
  createSettingsService,
  createSubscriptionsService,
} from "../src/index";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("article content persistence", () => {
  let pool: ReturnType<typeof createLocalPool>,
    db: NodePgDatabase<typeof schema>;
  const owner = randomUUID(),
    other = randomUUID();
  let id: number, feedId: number, at: number;
  const article = {
    url: "https://example.com/final/",
    title: "Extracted",
    byline: "author",
    siteName: "site",
    excerpt: "",
    contentHtml:
      '<p>Full content<img src="https://example.com/final/chart.png"></p>',
    imageUrl: "",
    publishedAt: null,
    extracted: true,
  };
  const extract = vi.fn(async () => article);
  let service: ReturnType<typeof createArticleContentService>;
  beforeAll(async () => {
    pool = createLocalPool({ connectionString: url ?? "" });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../db/drizzle", import.meta.url),
      ),
    });
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, feeds, user_entries, user_settings, read_later_items, user_media, media_objects, subscriptions RESTART IDENTITY CASCADE`,
    );
    await db.insert(schema.users).values([
      { id: owner, cognitoSub: owner, username: "owner" },
      { id: other, cognitoSub: other, username: "other" },
    ]);
    const [feed] = await db
      .insert(schema.feeds)
      .values({ url: "https://example.com/feed" })
      .returning();
    feedId = feed?.id ?? 0;
    await db.insert(schema.subscriptions).values({ userId: owner, feedId });
    const [entry] = await db
      .insert(schema.userEntries)
      .values({
        userId: owner,
        feedId,
        guid: "one",
        guidHash: "one",
        contentHtml: "Original",
        url: "https://example.com/one",
        publishedAt: new Date(0),
      })
      .returning();
    id = entry?.id ?? 0;
    at = Date.now();
    extract.mockReset().mockResolvedValue(article);
    service = createArticleContentService({ db, extract, now: () => at });
  });
  it("normalizes legacy NULL, preserves preference edits and isolates subscribers", async () => {
    const subs = createSubscriptionsService({ db });
    expect((await subs.list(owner))[0]?.fetchFullArticles).toBe(true);
    await db.update(schema.subscriptions).set({ fetchFullArticles: null });
    expect((await subs.list(owner))[0]?.fetchFullArticles).toBe(true);
    await db.insert(schema.subscriptions).values({ userId: other, feedId });
    await subs.edit(owner, feedId, { fetchFullArticles: false });
    await subs.edit(owner, feedId, { title: "Renamed", categoryId: null });
    await subs.subscribeDirect(owner, "https://example.com/feed");
    expect((await subs.list(owner))[0]?.fetchFullArticles).toBe(false);
    expect((await subs.list(other))[0]?.fetchFullArticles).toBe(true);
    await expect(
      subs.edit(randomUUID(), feedId, { fetchFullArticles: false }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await service.get(owner, id)).fullContent.fetchEnabled).toBe(false);
  });
  it.each(["automatic", "manual"] as const)(
    "skips opted-out %s requests without attempts or budget",
    async (trigger) => {
      await db.update(schema.subscriptions).set({ fetchFullArticles: false });
      const result = await service.ensure(owner, id, trigger);
      expect(result).toMatchObject({
        status: 200,
        retryAfter: null,
        content: {
          contentHtml: "Original",
          fullContent: { fetchEnabled: false, automaticFetchEligible: false },
        },
      });
      expect(extract).not.toHaveBeenCalled();
      expect(await db.select().from(schema.userSettings)).toHaveLength(0);
      expect(
        (await db.select().from(schema.userEntries))[0]?.contentAttemptToken,
      ).toBeNull();
      await expect(service.ensure(other, id, trigger)).rejects.toMatchObject({
        status: 404,
      });
    },
  );
  it("retains successful extraction through opt-out and re-enable across projections", async () => {
    await service.ensure(owner, id, "manual");
    const subs = createSubscriptionsService({ db });
    await subs.edit(owner, feedId, { fetchFullArticles: false });
    expect((await service.get(owner, id)).contentHtml).toBe("Original");
    const decorated = await service.decorate(owner, [
      { id: String(id), contentHtml: "old" },
      { id: "alias", source: "entry", entryId: String(id), contentHtml: "old" },
      { id: "url", source: "url", contentHtml: "URL body" },
    ]);
    expect(decorated.map((item) => item.contentHtml)).toEqual([
      "Original",
      "Original",
      "URL body",
    ]);
    expect(
      (await service.ensure(owner, id, "manual")).content.fullContent.status,
    ).toBe("ready");
    expect(
      (await db.select().from(schema.userEntries))[0]?.fullContentHtml,
    ).toBe(article.contentHtml);
    await subs.edit(owner, feedId, { fetchFullArticles: true });
    expect(
      (await service.ensure(owner, id, "automatic")).content.contentHtml,
    ).toBe(article.contentHtml);
    expect(extract).toHaveBeenCalledTimes(1);
  });
  it("does not restore fetched display when an admitted request finishes after opt-out", async () => {
    let finish!: (value: typeof article) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    extract.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const request = service.ensure(owner, id, "automatic");
    await ready;
    await createSubscriptionsService({ db }).edit(owner, feedId, {
      fetchFullArticles: false,
    });
    expect((await service.ensure(owner, id, "manual")).status).toBe(200);
    finish(article);
    expect(await request).toMatchObject({
      status: 200,
      content: {
        contentHtml: "Original",
        fullContent: { fetchEnabled: false },
      },
    });
    expect(extract).toHaveBeenCalledTimes(1);
  });
  it("fails closed when an owned entry has no subscription", async () => {
    await db.delete(schema.subscriptions);
    expect(
      (await service.ensure(owner, id, "manual")).content.fullContent
        .fetchEnabled,
    ).toBe(false);
    expect(extract).not.toHaveBeenCalled();
  });
  it("defaults old entries to idle, preserves original and preferences, projects aliases and caches success", async () => {
    expect((await service.get(owner, id)).fullContent.status).toBe("idle");
    const settings = createSettingsService({ db });
    await settings.merge(owner, { themeId: "blue" });
    const result = await service.ensure(owner, id, "manual");
    expect(result.status).toBe(200);
    await settings.merge(owner, { themeId: "red" });
    expect(
      (await db.select().from(schema.userSettings))[0]?.contentFetchAdmissions,
    ).toHaveLength(1);
    expect(await settings.get(owner)).toEqual({ themeId: "red" });
    const [original] = await createEntriesService({ db }).getByIds(owner, [id]);
    expect(original?.contentHtml).toBe("Original");
    const readLater = createReadLaterService({ db });
    await readLater.saveEntries(owner, [id], true);
    const page = await readLater.list(owner, {});
    const [alias] = await service.decorate(owner, page.items);
    expect(alias?.contentHtml).toBe(article.contentHtml);
    await service.ensure(owner, id, "automatic");
    expect(extract).toHaveBeenCalledTimes(1);
    expect((await service.get(owner, id)).originalContentHtml).toBe("Original");
  });
  it("retries admission conflicts without refetching and preserves concurrent preference writes", async () => {
    const conflict = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), { code: "40001" }),
      );
    try {
      await Promise.all([
        service.ensure(owner, id, "manual"),
        createSettingsService({ db }).merge(owner, { themeId: "blue" }),
      ]);
      expect(extract).toHaveBeenCalledTimes(1);
      expect(await createSettingsService({ db }).get(owner)).toEqual({
        themeId: "blue",
      });
      expect(
        (await db.select().from(schema.userSettings))[0]
          ?.contentFetchAdmissions,
      ).toHaveLength(1);
    } finally {
      conflict.mockRestore();
    }
  });
  it("skips long original feed bodies automatically without consuming budget but permits manual fetch", async () => {
    await db
      .update(schema.userEntries)
      .set({ contentHtml: `<p>${"a".repeat(500)}</p>` })
      .where(eq(schema.userEntries.id, id));
    const skipped = await service.ensure(owner, id, "automatic");
    expect(skipped.status).toBe(200);
    expect(skipped.content.fullContent).toMatchObject({
      status: "idle",
      automaticFetchEligible: false,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(await db.select().from(schema.userSettings)).toHaveLength(0);
    expect((await service.ensure(owner, id, "manual")).status).toBe(200);
    expect(extract).toHaveBeenCalledTimes(1);
    const cached = await service.ensure(owner, id, "automatic");
    expect(cached.content.contentHtml).toBe(article.contentHtml);
    expect(extract).toHaveBeenCalledTimes(1);
  });
  it("initializes nullable admission columns on preexisting settings rows", async () => {
    await db.insert(schema.userSettings).values({
      userId: owner,
      contentFetchAdmissions: null,
      contentFetchVersion: null,
      data: { themeId: "blue" },
    });
    expect((await service.ensure(owner, id, "manual")).status).toBe(200);
    const [settings] = await db.select().from(schema.userSettings);
    expect(settings?.contentFetchVersion).toBe(1);
    expect(settings?.contentFetchAdmissions).toHaveLength(1);
    expect(settings?.data).toEqual({ themeId: "blue" });
  });
  it("authorizes before fetching and refuses URL replacement", async () => {
    await expect(service.ensure(other, id, "manual")).rejects.toMatchObject({
      status: 404,
    });
    expect(extract).not.toHaveBeenCalled();
  });
  it("coalesces tabs and deletion cannot resurrect a source", async () => {
    let release!: (value: typeof article) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    extract.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const first = service.ensure(owner, id, "manual");
    await ready;
    expect((await service.ensure(owner, id, "automatic")).status).toBe(202);
    await db.delete(schema.userEntries).where(eq(schema.userEntries.id, id));
    release(article);
    await expect(first).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(schema.userEntries)).toHaveLength(0);
  });
  it("persists failure and separates manual/automatic cooldown", async () => {
    extract.mockRejectedValueOnce(new Error("private error"));
    const failure = await service.ensure(owner, id, "manual");
    expect(failure.status).toBe(502);
    expect(failure.content.contentHtml).toBe("Original");
    expect(failure.message).not.toContain("private");
    expect((await service.ensure(owner, id, "manual")).status).toBe(429);
    at += 31_000;
    expect((await service.ensure(owner, id, "automatic")).status).toBe(429);
    expect((await service.ensure(owner, id, "manual")).status).toBe(200);
  });
  it("recovers expired leases without letting stale work overwrite new content", async () => {
    let release!: (value: typeof article) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    extract.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const first = service.ensure(owner, id, "manual");
    await ready;
    at += 60_001;
    expect((await service.ensure(owner, id, "manual")).status).toBe(200);
    release({ ...article, contentHtml: "stale" });
    await first;
    expect((await service.get(owner, id)).contentHtml).toBe(
      article.contentHtml,
    );
  });
  it("serializes budget across entries and preserves all retry attempts", async () => {
    const ids = [id];
    for (let n = 1; n < 3; n++) {
      const [entry] = await db
        .insert(schema.userEntries)
        .values({
          userId: owner,
          feedId,
          guid: String(n),
          guidHash: String(n),
          url: "https://example.com/a",
          publishedAt: new Date(),
        })
        .returning();
      ids.push(entry?.id ?? 0);
    }
    await db.insert(schema.userSettings).values({
      userId: owner,
      contentFetchAdmissions: Array.from({ length: 29 }, (_, n) => at - n),
    });
    const results = await Promise.all(
      ids.map((entryId) => service.ensure(owner, entryId, "manual")),
    );
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 429)).toHaveLength(2);
    expect(extract).toHaveBeenCalledTimes(1);
    const [state] = await db.select().from(schema.userSettings);
    expect(state?.contentFetchAdmissions).toHaveLength(30);
  });
  it("authorizes fetched images without granting arbitrary image access", async () => {
    await service.ensure(owner, id, "manual");
    const fetchImage = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      mimeType: "image/png",
      width: 10,
      height: 10,
      candidate: {
        url: "https://example.com/final/chart.png",
        alt: "",
        order: 0,
        source: "content" as const,
      },
    }));
    const images = createSavedImagesService({
      db,
      media: createMediaService({ db, store: { put: async () => {} } }),
      fetchImage,
    });
    await images.save(
      owner,
      { kind: "entry", id: String(id) },
      "https://example.com/final/chart.png",
    );
    await expect(
      images.save(
        owner,
        { kind: "entry", id: String(id) },
        "https://example.com/foreign.png",
      ),
    ).rejects.toBeTruthy();
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(
      await db
        .select()
        .from(schema.userEntries)
        .where(
          and(
            eq(schema.userEntries.userId, owner),
            eq(schema.userEntries.id, id),
          ),
        ),
    ).toHaveLength(1);
  });
});
