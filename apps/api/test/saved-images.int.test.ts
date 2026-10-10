import { randomUUID } from "node:crypto";
import { guidHash, type SavedImageDto } from "@sparkle/core";
import * as schema from "@sparkle/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ALLOW_INSECURE_DEV_AUTH = "true";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/sparkle_test";
const { app } = await import("../src/app");
const { createLocalPool } = await import("@sparkle/db");

describe.skipIf(!process.env.TEST_DATABASE_URL)("saved image web API", () => {
  let pool: ReturnType<typeof createLocalPool>;
  let entryId: number;
  let imageId: string;
  const mediaId = randomUUID();
  const headers = {
    "X-Dev-User": `saved-${randomUUID()}`,
    "Content-Type": "application/json",
  };
  const foreign = { "X-Dev-User": `foreign-${randomUUID()}` };
  const previous = {
    bucket: process.env.MEDIA_BUCKET,
    endpoint: process.env.S3_ENDPOINT,
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
  };
  beforeAll(async () => {
    process.env.MEDIA_BUCKET = "saved-test";
    process.env.S3_ENDPOINT = "http://localhost:4566";
    process.env.AWS_ACCESS_KEY_ID = "test";
    process.env.AWS_SECRET_ACCESS_KEY = "test";
    process.env.AWS_REGION = "us-east-1";
    pool = createLocalPool({
      connectionString: process.env.TEST_DATABASE_URL ?? "",
    });
    const db = drizzle(pool, { schema });
    await db.execute(
      sql`DROP TABLE IF EXISTS read_later_items,user_media,media_objects,user_entries,subscriptions,feeds,categories,api_tokens,user_settings,users CASCADE`,
    );
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, {
      migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url)
        .pathname,
    });
    const me = (await (
      await app.request("/api/v1/me", { headers })
    ).json()) as { userId: string };
    const feedId =
      (
        await db
          .insert(schema.feeds)
          .values({ url: "https://example.com/feed", title: "Example" })
          .returning()
      )[0]?.id ?? 0;
    await db.insert(schema.subscriptions).values({ userId: me.userId, feedId });
    entryId =
      (
        await db
          .insert(schema.userEntries)
          .values({
            userId: me.userId,
            feedId,
            guid: "saved",
            guidHash: guidHash("saved"),
            url: "https://example.com/article",
            title: "Article",
            contentHtml: '<img src="/image.png">',
            publishedAt: new Date(),
            isStarred: true,
            starredAt: new Date(),
          })
          .returning()
      )[0]?.id ?? 0;
    await db.insert(schema.mediaObjects).values({
      id: mediaId,
      objectKey: "media/test",
      sha256: "test",
      mimeType: "image/png",
      byteSize: 100,
      width: 300,
      height: 300,
      sourceUrl: "https://example.com/image.png",
    });
    await db.insert(schema.userMedia).values({
      id: randomUUID(),
      userId: me.userId,
      entryId,
      mediaObjectId: mediaId,
      kind: "article_splash",
    });
  });
  afterAll(async () => {
    await pool?.end();
    for (const [name, value] of Object.entries({
      MEDIA_BUCKET: previous.bucket,
      S3_ENDPOINT: previous.endpoint,
      AWS_ACCESS_KEY_ID: previous.key,
      AWS_SECRET_ACCESS_KEY: previous.secret,
      AWS_REGION: previous.region,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const save = (h = headers, imageUrl = "/image.png") =>
    app.request("/api/v1/saved-images", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        source: { kind: "entry", id: String(entryId) },
        imageUrl,
      }),
    });
  it("saves an authorized image with signed delivery and returns the same duplicate", async () => {
    const response = await save();
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      item: {
        id: string;
        image: { id: string; url: string; urlExpiresAtMs: number };
      };
    };
    imageId = body.item.id;
    expect(body.item.image.id).toBe(mediaId);
    expect(body.item.image.url).toContain("X-Amz-Signature");
    expect(body.item.image.urlExpiresAtMs).toBeGreaterThan(Date.now());
    expect(
      ((await (await save()).json()) as { item: SavedImageDto }).item.id,
    ).toBe(imageId);
  });
  it("returns a mixed library and source save state", async () => {
    const body = (await (
      await app.request("/api/v1/saved", { headers })
    ).json()) as { items: Array<{ kind: string }> };
    expect(
      body.items.map((item: { kind: string }) => item.kind).sort(),
    ).toEqual(["article", "image"]);
    const state = (await (
      await app.request(
        `/api/v1/saved-images?sourceKind=entry&sourceId=${entryId}`,
        { headers },
      )
    ).json()) as { items: SavedImageDto[] };
    expect(state.items[0]?.id).toBe(imageId);
    expect(
      (
        (await (
          await app.request(`/api/v1/saved-images/${imageId}`, { headers })
        ).json()) as { item: SavedImageDto }
      ).item.source.articleTitle,
    ).toBe("Article");
  });
  it("rejects mismatched URLs, foreign sources and invalid inputs", async () => {
    expect((await save(headers, "/not-an-image")).status).toBe(400);
    expect((await save({ ...headers, ...foreign })).status).toBe(404);
    expect(
      (
        await app.request("/api/v1/saved-images", {
          method: "POST",
          headers,
          body: JSON.stringify({
            source: { kind: "entry", id: "invalid" },
            imageUrl: "/image.png",
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/v1/saved?cursor=invalid", { headers })).status,
    ).toBe(400);
  });
  it("isolates detail, removal, media, and list to the owner", async () => {
    expect(
      (
        await app.request(`/api/v1/saved-images/${imageId}`, {
          headers: foreign,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/saved-images/${imageId}`, {
          method: "DELETE",
          headers: foreign,
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/v1/media/${mediaId}`, { headers: foreign }))
        .status,
    ).toBe(404);
    expect(
      (
        (await (
          await app.request("/api/v1/saved", { headers: foreign })
        ).json()) as { items: unknown[] }
      ).items,
    ).toEqual([]);
    const { env } = await import("../src/env");
    const auth = {
      allowed: env.allowInsecureDevAuth,
      issuer: env.cognitoIssuer,
      client: env.cognitoClientId,
    };
    env.allowInsecureDevAuth = false;
    env.cognitoIssuer = "https://cognito.example.test";
    env.cognitoClientId = "test";
    try {
      expect((await app.request("/api/v1/saved")).status).toBe(401);
    } finally {
      env.allowInsecureDevAuth = auth.allowed;
      env.cognitoIssuer = auth.issuer;
      env.cognitoClientId = auth.client;
    }
  });
  it("fails clearly when storage is unavailable", async () => {
    delete process.env.MEDIA_BUCKET;
    expect((await save()).status).toBe(503);
    process.env.MEDIA_BUCKET = "saved-test";
  });
  it("removes only the image association without affecting starred articles or splashes", async () => {
    expect(
      (
        await app.request(`/api/v1/saved-images/${imageId}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(204);
    expect(
      (await app.request(`/api/v1/saved-images/${imageId}`, { headers }))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/api/v1/media/${mediaId}`, { headers })).status,
    ).toBe(302);
    const starred = (await (
      await app.request("/api/v1/entries?stream=starred", { headers })
    ).json()) as { items: Array<{ id: string }> };
    expect(starred.items.map((item: { id: string }) => item.id)).toContain(
      String(entryId),
    );
  });
});
