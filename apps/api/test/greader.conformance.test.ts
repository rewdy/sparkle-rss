import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { guidHash, toLongItemId } from "@sparkle/core";
import * as schema from "@sparkle/db";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ALLOW_INSECURE_DEV_AUTH = "true";
process.env.GREADER_HMAC_KEY = "conformance-hmac-key";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/sparkle_test";

const { app } = await import("../src/app");
const { createLocalPool } = await import("@sparkle/db");

const DEV_USER = `nnw-user-${randomUUID().slice(0, 8)}`;
const H = { "X-Dev-User": DEV_USER };
const JSONH = { ...H, "Content-Type": "application/json" };

let server: Server;
let serverPort = 0;

describe.skipIf(!process.env.TEST_DATABASE_URL)("greader conformance", () => {
  let pool: ReturnType<typeof createLocalPool>;
  let db: NodePgDatabase<typeof schema>;
  let userId = "";
  let apiToken = "";
  let auth = "";
  let feedId = 0;
  const entryIdsByGuid = new Map<string, number>();

  beforeAll(async () => {
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error("TEST_DATABASE_URL required");
    pool = createLocalPool({ connectionString: testDbUrl });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP TABLE IF EXISTS user_entries, subscriptions, feeds, categories,
      api_tokens, user_settings, users CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, {
      migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url)
        .pathname,
    });

    // fixture HTTP server so subscribe/discovery never touches the internet
    const feedXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Conform Feed</title>
      <item><title>s-one</title><guid>s-1</guid></item></channel></rss>`;
    server = createServer((req, res) => {
      if (req.url?.includes("rss")) {
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end(feedXml);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          '<html><link rel="alternate" type="application/rss+xml" href="/rss"></html>',
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    serverPort = (server.address() as { port: number }).port;

    // provision caller identity + an API token through the first-party surface
    const me = await app.request("/api/v1/me", { headers: H });
    userId = ((await me.json()) as { userId: string }).userId;
    const minted = await app.request("/api/v1/me/api-tokens", {
      method: "POST",
      headers: JSONH,
      body: JSON.stringify({ label: "nnw" }),
    });
    apiToken = ((await minted.json()) as { token: string }).token;

    auth = await clientLogin();
  });

  async function clientLogin(): Promise<string> {
    const res = await app.request("/api/greader.php/accounts/ClientLogin", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        Email: DEV_USER,
        Passwd: apiToken,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const auth =
      text
        .split("\n")
        .find((l) => l.startsWith("Auth="))
        ?.slice(5) ?? "";
    return auth.trim();
  }

  function authHeader(auth: string): Record<string, string> {
    return { Authorization: `GoogleLogin auth=${auth}` };
  }

  afterAll(async () => {
    server?.close();
    await pool?.end();
  });

  it("root and compatibility checks answer OK", async () => {
    expect(await (await app.request("/api/greader.php")).text()).toBe("OK");
    expect(
      await (await app.request("/api/greader.php/check/compatibility")).text(),
    ).toBe("OK");
  });

  it("rejects bad ClientLogin credentials", async () => {
    const res = await app.request("/api/greader.php/accounts/ClientLogin", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        Email: DEV_USER,
        Passwd: "srk_wrong",
      }).toString(),
    });
    expect(res.status).toBe(401);
  });

  it("guards reader endpoints behind GoogleLogin auth", async () => {
    expect(
      (await app.request("/api/greader.php/reader/api/0/user-info")).status,
    ).toBe(401);
    const bad = await app.request("/api/greader.php/reader/api/0/user-info", {
      headers: authHeader(`${userId}/forged`),
    });
    expect(bad.status).toBe(401);
  });

  it("subscribes over HTTP via discovery (fixture server)", async () => {
    const res = await app.request(
      "/api/greader.php/reader/api/0/subscription/quickadd",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          quickadd: `http://127.0.0.1:${serverPort}/blog`,
        }).toString(),
      },
    );
    const body = (await res.json()) as { numResults: number; streamId: string };
    expect(body.numResults).toBe(1);
    feedId = Number(body.streamId.slice(5));
  });

  async function seedEntry(
    guid: string,
    title: string,
    daysAgo: number,
    opts: { read?: boolean; starred?: boolean } = {},
  ) {
    const users = await db.select().from(schema.users);
    const internalId = users.at(0)?.id ?? "";
    const rows = await db
      .insert(schema.userEntries)
      .values({
        userId: internalId,
        feedId,
        guid,
        guidHash: guidHash(guid),
        title,
        contentHtml: `<p>${title} body</p>`,
        url: `https://conform.example/${guid}`,
        author: "Author",
        publishedAt: new Date(Date.UTC(2026, 6, 22 - daysAgo)),
        enclosures: [],
        isRead: opts.read ?? false,
        isStarred: opts.starred ?? false,
        starredAt: opts.starred ? new Date() : null,
      })
      .returning({ id: schema.userEntries.id });
    entryIdsByGuid.set(guid, rows[0]?.id ?? -1);
    return rows[0]?.id ?? -1;
  }

  it("stream/items/ids paginates with correct units and filters", async () => {
    await seedEntry("c-1", "Newest", 0);
    await seedEntry("c-2", "Middle", 1);
    await seedEntry("c-3", "Oldest", 2);

    const page1 = await app.request(
      `/api/greader.php/reader/api/0/stream/items/ids?s=feed/${feedId}&n=2&output=json`,
      { headers: authHeader(auth) },
    );
    const p1 = (await page1.json()) as {
      itemRefs: Array<{ id: string; timestampUsec: string }>;
      continuation?: string;
    };
    expect(p1.itemRefs.map((r) => Number(r.id))).toEqual([
      entryIdsByGuid.get("c-1"),
      entryIdsByGuid.get("c-2"),
    ]);
    expect(p1.continuation).toBeTruthy();
    // timestampUsec must be a STRING of microseconds
    expect(typeof p1.itemRefs[0]?.timestampUsec).toBe("string");
    expect(BigInt(p1.itemRefs[0]?.timestampUsec ?? "0")).toBeGreaterThan(1e15);

    const page2 = await app.request(
      `/api/greader.php/reader/api/0/stream/items/ids?s=feed/${feedId}&n=2&output=json&c=${encodeURIComponent(p1.continuation ?? "")}`,
      { headers: authHeader(auth) },
    );
    const p2 = (await page2.json()) as {
      itemRefs: Array<{ id: string }>;
      continuation?: string;
    };
    expect(p2.itemRefs.map((r) => Number(r.id))).toEqual([
      entryIdsByGuid.get("c-3"),
    ]);
    expect(p2.continuation).toBeUndefined();

    const asc = await app.request(
      `/api/greader.php/reader/api/0/stream/items/ids?s=feed/${feedId}&n=10&r=o&output=json`,
      { headers: authHeader(auth) },
    );
    const a = (await asc.json()) as { itemRefs: Array<{ id: string }> };
    expect(a.itemRefs[0]?.id).toBe(String(entryIdsByGuid.get("c-3")));
  });

  it("excludes read items via xt", async () => {
    const readId = entryIdsByGuid.get("c-3") ?? -1;
    await db
      .update(schema.userEntries)
      .set({ isRead: true })
      .where(sql`id = ${readId}`);
    const res = await app.request(
      `/api/greader.php/reader/api/0/stream/items/ids?s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=100&output=json`,
      { headers: authHeader(auth) },
    );
    const body = (await res.json()) as { itemRefs: Array<{ id: string }> };
    expect(body.itemRefs.some((r) => Number(r.id) === readId)).toBe(false);
  });

  it("serves stream contents with full GR item envelopes", async () => {
    const newestId = entryIdsByGuid.get("c-1");
    if (newestId === undefined) throw new Error("c-1 missing");
    const res = await app.request(
      `/api/greader.php/reader/api/0/stream/contents/feed/${feedId}?output=json&n=1`,
      { headers: authHeader(auth) },
    );
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      continuation?: string;
    };
    const item = body.items[0] as {
      id: string;
      published: number;
      crawlTimeMsec: string;
      timestampUsec: string;
      canonical: Array<{ href: string }>;
      origin: { streamId: string; title: string };
      summary: { content: string };
      categories: string[];
      enclosure?: unknown[];
    };
    expect(item.id).toBe(toLongItemId(BigInt(newestId)));
    expect(Number.isInteger(item.published)).toBe(true);
    expect(typeof item.crawlTimeMsec).toBe("string");
    expect(item.canonical[0]?.href).toContain("conform.example");
    expect(item.origin.streamId).toBe(`feed/${feedId}`);
    expect(item.summary.content).toContain("body");
    expect(item.categories).toContain("user/-/state/com.google/reading-list");
    expect(body.items).toHaveLength(1);
  });

  it("hydrates batched items accepting both id forms", async () => {
    const shortId = String(entryIdsByGuid.get("c-2"));
    const longId = toLongItemId(BigInt(entryIdsByGuid.get("c-1") ?? -1));
    const res = await app.request(
      "/api/greader.php/reader/api/0/stream/items/contents",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: (() => {
          const p = new URLSearchParams();
          p.append("i", longId);
          p.append("i", shortId);
          return p.toString();
        })(),
      },
    );
    const _hydBody = (await res
      .clone()
      .json()
      .catch(() => null)) as { items: Array<{ id: string }> } | null;
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(2);
  });

  it("toggles star via edit-tag using both tag directions", async () => {
    const id = entryIdsByGuid.get("c-2");
    if (id === undefined) throw new Error("c-2 missing");
    const star = await app.request("/api/greader.php/reader/api/0/edit-tag", {
      method: "POST",
      headers: {
        ...authHeader(auth),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        i: String(id),
        a: "user/-/state/com.google/starred",
        T: "",
      }).toString(),
    });
    expect(await star.text()).toBe("OK");

    const counts = await app.request(
      "/api/greader.php/reader/api/0/unread-count?output=json",
      {
        headers: authHeader(auth),
      },
    );
    void counts;

    const unstar = await app.request("/api/greader.php/reader/api/0/edit-tag", {
      method: "POST",
      headers: {
        ...authHeader(auth),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        i: String(id),
        r: "user/-/state/com.google/starred",
        T: "x",
      }).toString(),
    });
    expect(await unstar.text()).toBe("OK");
  });

  it("rejects forged write tokens but tolerates empty and x", async () => {
    const base = "/api/greader.php/reader/api/0/edit-tag";
    const form = new URLSearchParams({
      i: "1",
      a: "user/-/state/com.google/starred",
      T: "bogus",
    });
    const bad = await app.request(base, {
      method: "POST",
      headers: {
        ...authHeader(auth),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("X-Reader-Google-Bad-Token")).toBe("true");

    const none = await app.request(base, {
      method: "POST",
      headers: {
        ...authHeader(auth),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ i: "1" }).toString(),
    });
    expect(none.status).toBe(200); // empty token tolerated (FeedMe/Reeder)
  });

  it("manages folders through rename-tag and disable-tag", async () => {
    const mk = await app.request("/api/v1/folders", {
      method: "POST",
      headers: JSONH,
      body: JSON.stringify({ name: "OldName" }),
    });
    expect(mk.status).toBe(201);

    const rename = await app.request(
      "/api/greader.php/reader/api/0/rename-tag",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          s: "user/-/label/OldName",
          dest: "user/-/label/NewName",
        }).toString(),
      },
    );
    expect(await rename.text()).toBe("OK");

    const tags = await app.request(
      "/api/greader.php/reader/api/0/tag/list?output=json",
      {
        headers: authHeader(auth),
      },
    );
    const tagBody = (await tags.json()) as { tags: Array<{ id: string }> };
    expect(tagBody.tags.some((t) => t.id === "user/-/label/NewName")).toBe(
      true,
    );

    const disable = await app.request(
      "/api/greader.php/reader/api/0/disable-tag",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ s: "user/-/label/NewName" }).toString(),
      },
    );
    expect(await disable.text()).toBe("OK");
  });

  it("mark-all-as-read honors nanosecond bounds", async () => {
    const cutoffNs = `${Date.UTC(2026, 6, 20, 12)}000000`; // between c-3 (oldest) and c-2
    const res = await app.request(
      "/api/greader.php/reader/api/0/mark-all-as-read",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          s: `feed/${feedId}`,
          ts: cutoffNs,
        }).toString(),
      },
    );
    expect(await res.text()).toBe("OK");

    const rows = await db.select().from(schema.userEntries);
    const byGuid = new Map(rows.map((r) => [r.guid, r.isRead]));
    expect(byGuid.get("c-3")).toBe(true); // oldest → read
    expect(byGuid.get("c-2")).toBe(false); // newer than cutoff → untouched
    expect(byGuid.get("c-1")).toBe(false);
  });

  it("round-trips OPML export/import", async () => {
    const exported = await app.request(
      "/api/greader.php/reader/api/0/subscription/export",
      {
        headers: authHeader(auth),
      },
    );
    expect(await exported.text()).toContain(`xmlUrl=`);

    const opmlWithFolder = `<?xml version="1.0"?><opml version="2.0"><body>
      <outline text="Imported"><outline type="rss" text="Imp" xmlUrl="https://imp.example/f"/></outline>
    </body></opml>`;
    const imported = await app.request(
      "/api/greader.php/reader/api/0/subscription/import",
      {
        method: "POST",
        headers: { ...authHeader(auth) },
        body: opmlWithFolder,
      },
    );
    expect(await imported.text()).toBe("OK");

    const subs = await app.request(
      "/api/greader.php/reader/api/0/subscription/list?output=json",
      {
        headers: authHeader(auth),
      },
    );
    const list = (await subs.json()) as {
      subscriptions: Array<{ url: string; categories: Array<{ id: string }> }>;
    };
    const importedSub = list.subscriptions.find(
      (s) => s.url === "https://imp.example/f",
    );
    expect(importedSub?.categories[0]?.id).toBe("user/-/label/Imported");
  });

  it("renames a feed via subscription/edit and moves its folder", async () => {
    const edited = await app.request(
      "/api/greader.php/reader/api/0/subscription/edit",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          ac: "edit",
          s: `feed/${feedId}`,
          t: "Renamed Via API",
          a: "user/-/label/MovedFolder",
        }).toString(),
      },
    );
    expect(await edited.text()).toBe("OK");

    const subs = await app.request(
      "/api/greader.php/reader/api/0/subscription/list?output=json",
      {
        headers: authHeader(auth),
      },
    );
    const list = (await subs.json()) as {
      subscriptions: Array<{
        id: string;
        title: string;
        categories: Array<{ label: string }>;
      }>;
    };
    const mine = list.subscriptions.find((s) => s.id === `feed/${feedId}`);
    expect(mine?.title).toBe("Renamed Via API");
    expect(mine?.categories[0]?.label).toBe("MovedFolder");
  });

  it("unsubscribes via subscription/edit", async () => {
    const res = await app.request(
      "/api/greader.php/reader/api/0/subscription/edit",
      {
        method: "POST",
        headers: {
          ...authHeader(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          ac: "unsubscribe",
          s: `feed/${feedId}`,
        }).toString(),
      },
    );
    expect(await res.text()).toBe("OK");
    const subs = await app.request(
      "/api/greader.php/reader/api/0/subscription/list?output=json",
      {
        headers: authHeader(auth),
      },
    );
    const list = (await subs.json()) as {
      subscriptions: Array<{ id: string }>;
    };
    expect(
      list.subscriptions.find((s) => s.id === `feed/${feedId}`),
    ).toBeUndefined();
  });
});
