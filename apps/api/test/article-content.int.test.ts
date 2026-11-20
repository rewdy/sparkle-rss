import { randomUUID } from "node:crypto";
import {
  type ContentProjection,
  createArticleContentService,
  extractArticle,
} from "@sparkle/core";
import * as schema from "@sparkle/db";
import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.ALLOW_INSECURE_DEV_AUTH = "true";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/sparkle_test";
const { app } = await import("../src/app");
const { getServices } = await import("../src/services");
const { createLocalPool } = await import("@sparkle/db");
const H = {
  "X-Dev-User": `content-${randomUUID()}`,
  "Content-Type": "application/json",
};
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "full content web contract",
  () => {
    let pool: ReturnType<typeof createLocalPool>,
      db: NodePgDatabase<typeof schema>,
      id: number,
      userId: string;
    const extract = vi.fn(async () =>
      extractArticle(
        `<html><body><article><p>${"Readable full article content. ".repeat(30)}</p><img src="relative.png"></article></body></html>`,
        "https://example.com/final/",
      ),
    );
    beforeAll(async () => {
      pool = createLocalPool({
        connectionString: process.env.TEST_DATABASE_URL ?? "",
      });
      db = drizzle(pool, { schema });
      await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
      await db.execute(sql`CREATE SCHEMA public`);
      await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
      await migrate(db, {
        migrationsFolder: new URL(
          "../../../packages/db/drizzle",
          import.meta.url,
        ).pathname,
      });
      const me = await app.request("/api/v1/me", { headers: H });
      userId = ((await me.json()) as { userId: string }).userId;
      const [feed] = await db
        .insert(schema.feeds)
        .values({ url: "https://example.com/feed" })
        .returning();
      await db
        .insert(schema.subscriptions)
        .values({ userId, feedId: feed?.id ?? 0 });
      const [entry] = await db
        .insert(schema.userEntries)
        .values({
          userId,
          feedId: feed?.id ?? 0,
          guid: "one",
          guidHash: "one",
          contentHtml: "teaser",
          url: "https://example.com/a",
          publishedAt: new Date(),
        })
        .returning();
      id = entry?.id ?? 0;
      const services = await getServices();
      services.articleContent = createArticleContentService({ db, extract });
    });
    afterAll(async () => {
      await pool?.end();
    });
    const post = (target = id, body = { trigger: "manual" }, headers = H) =>
      app.request(`/api/v1/entries/${target}/content`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    it("GET is side effect free and POST persists a web-only projection", async () => {
      const initial = await (
        await app.request(`/api/v1/entries/${id}`, { headers: H })
      ).json();
      expect(
        (initial as { entry: ContentProjection }).entry.fullContent.status,
      ).toBe("idle");
      expect(extract).not.toHaveBeenCalled();
      expect((await post()).status).toBe(200);
      const detail = await (
        await app.request(`/api/v1/entries/${id}`, { headers: H })
      ).json();
      expect(
        (detail as { entry: ContentProjection }).entry.originalContentHtml,
      ).toBe("teaser");
      expect(
        (detail as { entry: ContentProjection }).entry.contentHtml,
      ).toContain("Readable full");
      expect((await db.select().from(schema.userEntries))[0]?.contentHtml).toBe(
        "teaser",
      );
      expect((await post(id, { trigger: "automatic" })).status).toBe(200);
      expect(extract).toHaveBeenCalledTimes(1);
    });
    it("rejects missing/foreign IDs and caller URL injection", async () => {
      expect((await post(id + 100)).status).toBe(404);
      expect(
        (
          await post(
            id,
            { trigger: "manual" },
            { ...H, "X-Dev-User": "other-content-user" },
          )
        ).status,
      ).toBe(404);
      const response = await app.request(`/api/v1/entries/${id}/content`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          trigger: "manual",
          url: "https://evil.example",
        }),
      });
      expect(response.status).toBe(400);
      expect(extract).toHaveBeenCalledTimes(1);
    });
    it("persists feed opt-out and enforces both content triggers", async () => {
      const [entry] = await db
        .select()
        .from(schema.userEntries)
        .where(eq(schema.userEntries.id, id));
      const path = `/api/v1/subscriptions/${entry?.feedId}`;
      const patch = (body: unknown, headers = H) =>
        app.request(path, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        });
      expect((await patch({ fetchFullArticles: "false" })).status).toBe(400);
      expect(
        (
          await patch(
            { fetchFullArticles: false },
            { ...H, "X-Dev-User": "foreign-preference" },
          )
        ).status,
      ).toBe(404);
      const saved = await patch({ fetchFullArticles: false });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({
        subscription: { fetchFullArticles: false },
      });
      const before = (
        await db
          .select()
          .from(schema.userSettings)
          .where(eq(schema.userSettings.userId, userId))
      )[0]?.contentFetchAdmissions;
      for (const trigger of ["manual", "automatic"]) {
        const response = await post(id, { trigger });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          content: {
            contentHtml: "teaser",
            fullContent: { fetchEnabled: false, automaticFetchEligible: false },
          },
        });
      }
      const detail = await (
        await app.request(`/api/v1/entries/${id}`, { headers: H })
      ).json();
      expect(detail).toMatchObject({ entry: { contentHtml: "teaser" } });
      expect(
        (
          await db
            .select()
            .from(schema.userSettings)
            .where(eq(schema.userSettings.userId, userId))
        )[0]?.contentFetchAdmissions,
      ).toEqual(before);
      expect(extract).toHaveBeenCalledTimes(1);
      expect((await patch({ title: "Title only" })).status).toBe(200);
      expect(
        await (
          await app.request("/api/v1/subscriptions", { headers: H })
        ).json(),
      ).toMatchObject({ subscriptions: [{ fetchFullArticles: false }] });
      await patch({ fetchFullArticles: true });
    });
    it("returns pending and failure cooldown contracts with Retry-After", async () => {
      await db
        .update(schema.userEntries)
        .set({
          fullContentHtml: null,
          fullContentFetchedAt: null,
          contentAttemptToken: randomUUID(),
          contentAttemptAt: new Date(),
        })
        .where(eq(schema.userEntries.id, id));
      const pending = await post();
      expect(pending.status).toBe(202);
      expect(pending.headers.get("Retry-After")).toBe("2");
      await db
        .update(schema.userEntries)
        .set({ contentAttemptToken: null })
        .where(eq(schema.userEntries.id, id));
      extract.mockRejectedValueOnce(new Error("upstream secret"));
      const failure = await post();
      expect(failure.status).toBe(502);
      expect(await failure.text()).not.toContain("upstream secret");
      const limited = await post();
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    });
  },
);
