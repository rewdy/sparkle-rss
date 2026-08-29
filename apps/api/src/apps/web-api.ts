import { AppError, type StreamSelector } from "@sparkle/core";
import { Hono } from "hono";
import { z } from "zod";
import { getServices, type Services } from "../services";

type Env = { Variables: { cognitoSub: string; username?: string } };

const streamSchema = z.string().transform((value): StreamSelector => {
  if (value === "all" || value === "") return { type: "all" };
  if (value === "starred") return { type: "starred" };
  if (value.startsWith("feed:")) {
    const feedId = Number(value.slice(5));
    if (!Number.isInteger(feedId) || feedId <= 0)
      throw new AppError(400, "invalid feed stream");
    return { type: "feed", feedId };
  }
  if (value.startsWith("folder:")) {
    const categoryId = Number(value.slice(7));
    if (!Number.isInteger(categoryId) || categoryId <= 0)
      throw new AppError(400, "invalid folder stream");
    return { type: "folder", categoryId };
  }
  throw new AppError(400, `unknown stream: ${value}`);
});

const idArray = z.array(z.number().int().positive()).max(1000);

export function createWebApiApp(): Hono<Env> {
  const app = new Hono<Env>();

  /** Resolves the caller to our internal user id (auto-provisioned on first login). */
  async function userIdOf(
    s: Services,
    c: { get: (k: "cognitoSub" | "username") => string },
  ): Promise<string> {
    const user = await s.users.ensureByCognitoSub(
      c.get("cognitoSub"),
      c.get("username") ?? c.get("cognitoSub").slice(0, 24),
      "",
    );
    return user.id;
  }

  app.get("/ping", (c) => c.json({ ok: true, ts: Date.now() }));

  // --- me ------------------------------------------------------------------
  app.get("/me", async (c) => {
    const s = await getServices();
    const user = await s.users.ensureByCognitoSub(
      c.get("cognitoSub"),
      c.get("username") ?? c.get("cognitoSub").slice(0, 24),
      "",
    );
    return c.json({
      userId: user.id,
      username: user.username,
      email: user.email,
    });
  });

  // --- folders ---------------------------------------------------------------
  app.get("/folders", async (c) => {
    const s = await getServices();
    return c.json({ folders: await s.folders.list(await userIdOf(s, c)) });
  });

  app.post("/folders", async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(120) })
      .parse(await c.req.json());
    const s = await getServices();
    return c.json(
      { folder: await s.folders.create(await userIdOf(s, c), body.name) },
      201,
    );
  });

  app.patch("/folders/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) throw new AppError(400, "invalid folder id");
    const body = z
      .object({ name: z.string().min(1).max(120) })
      .parse(await c.req.json());
    const s = await getServices();
    await s.folders.rename(await userIdOf(s, c), id, body.name);
    return c.body(null, 204);
  });

  app.delete("/folders/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) throw new AppError(400, "invalid folder id");
    const s = await getServices();
    await s.folders.delete(await userIdOf(s, c), id);
    return c.body(null, 204);
  });

  // --- subscriptions ---------------------------------------------------------
  app.get("/subscriptions", async (c) => {
    const s = await getServices();
    return c.json({
      subscriptions: await s.subscriptions.list(await userIdOf(s, c)),
    });
  });

  app.post("/subscriptions", async (c) => {
    const body = z
      .object({
        url: z.string().url(),
        title: z.string().max(300).optional(),
        folderId: z.number().int().positive().nullable().optional(),
      })
      .parse(await c.req.json());
    const s = await getServices();
    const result = await s.subscriptions.subscribe(
      await userIdOf(s, c),
      body.url,
      {
        title: body.title,
        categoryId: body.folderId ?? null,
      },
    );
    return c.json(
      { subscription: result.subscription, created: result.created },
      201,
    );
  });

  app.patch("/subscriptions/:feedId", async (c) => {
    const feedId = Number(c.req.param("feedId"));
    if (!Number.isInteger(feedId)) throw new AppError(400, "invalid feed id");
    const body = z
      .object({
        title: z.string().max(300).nullable().optional(),
        folderId: z.number().int().positive().nullable().optional(),
      })
      .parse(await c.req.json());
    const s = await getServices();
    const subscription = await s.subscriptions.edit(
      await userIdOf(s, c),
      feedId,
      {
        title: body.title,
        categoryId: body.folderId,
      },
    );
    return c.json({ subscription });
  });

  app.delete("/subscriptions/:feedId", async (c) => {
    const feedId = Number(c.req.param("feedId"));
    if (!Number.isInteger(feedId)) throw new AppError(400, "invalid feed id");
    const s = await getServices();
    await s.subscriptions.unsubscribe(await userIdOf(s, c), feedId);
    return c.body(null, 204);
  });

  // --- entries ---------------------------------------------------------------
  app.get("/entries", async (c) => {
    const q = c.req.query();
    const parsed = z
      .object({
        stream: streamSchema,
        filter: z.enum(["all", "unread"]).default("all"),
        sort: z.enum(["asc", "desc"]).default("desc"),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
        ot: z.coerce.date().optional(),
        nt: z.coerce.date().optional(),
        pubFrom: z.coerce.date().optional(),
      })
      .parse({
        stream: q.stream ?? "all",
        filter: q.filter,
        sort: q.sort,
        limit: q.limit,
        cursor: q.cursor,
        ot: q.ot,
        nt: q.nt,
        pubFrom: q.pubFrom,
      });

    const s = await getServices();
    const page = await s.entries.list(await userIdOf(s, c), {
      stream: parsed.stream,
      unreadOnly: parsed.filter === "unread",
      order: parsed.sort,
      limit: parsed.limit,
      cursor: parsed.cursor,
      crawledAfter: parsed.ot,
      crawledBefore: parsed.nt,
      publishedFrom: parsed.pubFrom,
    });
    return c.json(page);
  });

  app.get("/entries/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      throw new AppError(400, "invalid entry id");
    const s = await getServices();
    const [entry] = await s.entries.getByIds(await userIdOf(s, c), [id]);
    if (!entry) throw new AppError(404, "entry not found");
    return c.json({ entry });
  });

  app.patch("/entries/read", async (c) => {
    const body = z
      .object({ ids: idArray, read: z.boolean() })
      .parse(await c.req.json());
    const s = await getServices();
    return c.json({
      updated: await s.entries.setReadState(
        await userIdOf(s, c),
        body.ids,
        body.read,
      ),
    });
  });

  app.patch("/entries/starred", async (c) => {
    const body = z
      .object({ ids: idArray, starred: z.boolean() })
      .parse(await c.req.json());
    const s = await getServices();
    return c.json({
      updated: await s.entries.setStarred(
        await userIdOf(s, c),
        body.ids,
        body.starred,
      ),
    });
  });

  app.post("/entries/mark-all-read", async (c) => {
    const body = z
      .object({
        stream: streamSchema.optional(),
        olderThan: z.coerce.date().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const s = await getServices();
    return c.json({
      updated: await s.entries.markAllRead(
        await userIdOf(s, c),
        body.stream ?? { type: "all" },
        body.olderThan ?? new Date(),
      ),
    });
  });

  app.get("/unread-counts", async (c) => {
    const s = await getServices();
    const userId = await userIdOf(s, c);
    const [byFeed, subs] = await Promise.all([
      s.entries.unreadCountsByFeed(userId),
      s.subscriptions.list(userId),
    ]);
    const feeds = subs.map((sub) => {
      const counts = byFeed.get(Number(sub.feedId));
      return {
        feedId: sub.feedId,
        count: counts?.count ?? 0,
        newestMs: counts?.newestMs ?? null,
      };
    });
    const total = feeds.reduce((sum, f) => sum + f.count, 0);
    const folderCounts = subs.reduce<Map<string, number>>((acc, sub) => {
      if (sub.categoryId) {
        acc.set(
          sub.categoryId,
          (acc.get(sub.categoryId) ?? 0) +
            (byFeed.get(Number(sub.feedId))?.count ?? 0),
        );
      }
      return acc;
    }, new Map());
    return c.json({
      total,
      feeds,
      folders: [...folderCounts.entries()].map(([folderId, count]) => ({
        folderId,
        count,
      })),
    });
  });

  // --- opml ------------------------------------------------------------------
  app.get("/opml/export", async (c) => {
    const s = await getServices();
    const subs = await s.subscriptions.list(await userIdOf(s, c));
    const xml = await s.opml.exportOpml(await userIdOf(s, c), subs);
    c.header("Content-Type", "application/xml; charset=UTF-8");
    c.header(
      "Content-Disposition",
      'attachment; filename="sparkle-subscriptions.opml"',
    );
    return c.body(xml);
  });

  app.post("/opml/import", async (c) => {
    const raw = await c.req.text();
    if (!raw.trim()) throw new AppError(400, "empty OPML body");
    const s = await getServices();
    const userId = await userIdOf(s, c);
    const items = await s.opml.parseImport(raw);
    let imported = 0;
    const errors: Array<{ url: string; error: string }> = [];
    for (const item of items.slice(0, 500)) {
      try {
        const categoryId =
          item.folderName !== null
            ? await s.opml.ensureFolderByName(userId, item.folderName)
            : null;
        await s.subscriptions.subscribeDirect(userId, item.feedUrl, {
          title: item.title,
          categoryId,
          siteUrl: item.siteUrl ?? undefined,
        });
        imported += 1;
      } catch (error) {
        errors.push({ url: item.feedUrl, error: (error as Error).message });
      }
    }
    return c.json({ found: items.length, imported, errors });
  });

  // --- settings --------------------------------------------------------------
  app.get("/settings", async (c) => {
    const s = await getServices();
    return c.json({ data: await s.settings.get(await userIdOf(s, c)) });
  });

  app.put("/settings", async (c) => {
    const body = z
      .object({ data: z.record(z.string(), z.unknown()) })
      .parse(await c.req.json());
    const s = await getServices();
    return c.json({
      data: await s.settings.merge(await userIdOf(s, c), body.data),
    });
  });

  // --- api tokens ------------------------------------------------------------
  app.get("/me/api-tokens", async (c) => {
    const s = await getServices();
    return c.json({ tokens: await s.apiTokens.list(await userIdOf(s, c)) });
  });

  app.post("/me/api-tokens", async (c) => {
    const body = z
      .object({ label: z.string().max(120).default("") })
      .parse(await c.req.json().catch(() => ({})));
    const s = await getServices();
    return c.json(
      await s.apiTokens.mint(await userIdOf(s, c), body.label),
      201,
    );
  });

  app.delete("/me/api-tokens/:id", async (c) => {
    const s = await getServices();
    await s.apiTokens.revoke(await userIdOf(s, c), c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
