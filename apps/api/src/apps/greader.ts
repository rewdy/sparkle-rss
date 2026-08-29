import { timingSafeEqual } from "node:crypto";
import type { StreamSelector } from "@sparkle/core";
import {
  AppError,
  deriveAuthSecret,
  deriveWriteToken,
  markAllAsReadTsToDate,
  msToCrawlTimeMsec,
  msToTimestampUsec,
  parseGoogleLoginHeader,
  parseItemId,
  sha256Hex,
  toLongItemId,
} from "@sparkle/core";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getHmacKey } from "../secrets";
import { getServices, type Services } from "../services";

type Env = { Variables: { greaderUserId: string } };

const LABEL_PREFIX = "user/-/label/";
const MAX_STREAM_ITEMS = 1000;

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function formArray(
  body: Record<string, unknown>,
  key: string,
): Promise<string[]> {
  const value = body[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * Google Reader clients repeat form keys (i=…&i=…); Hono's parseBody keeps
 * only the last value, so parse the raw body when it is urlencoded.
 */
async function allFormValues(c: Context<Env>, key: string): Promise<string[]> {
  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await c.req.text()).getAll(key);
  }
  return [];
}

/** Resolves `user/-/label/<name>` / `feed/<n>` / state strings to selectors. */
async function parseStreamId(
  services: Services,
  userId: string,
  raw: string | undefined,
): Promise<StreamSelector | null> {
  if (!raw || raw.trim() === "") return { type: "all" };
  const value = raw.trim();
  if (value === "user/-/state/com.google/reading-list") return { type: "all" };
  if (value === "user/-/state/com.google/starred") return { type: "starred" };
  if (value.startsWith("feed/")) {
    const numeric = Number(value.slice(5));
    if (Number.isInteger(numeric) && numeric > 0)
      return { type: "feed", feedId: numeric };
    return { type: "all" }; // URL-form streams degrade to reading-list
  }
  if (value.startsWith(LABEL_PREFIX)) {
    const name = decodeURIComponent(value.slice(LABEL_PREFIX.length));
    const id = await services.folders.findByName(userId, name);
    return id === null
      ? { type: "feed", feedId: -1 }
      : { type: "folder", categoryId: id };
  }
  throw new AppError(400, `unknown stream ${value}`);
}

export function createGreaderApp(): Hono<Env> {
  const app = new Hono<Env>();

  async function requireServices() {
    return getServices();
  }

  async function hmacKey(): Promise<string> {
    return getHmacKey();
  }

  function writeTokenFor(key: string, userId: string): string {
    return deriveWriteToken(key, userId);
  }

  function checkWriteToken(
    key: string,
    userId: string,
    provided: string,
  ): boolean {
    if (provided === "" || provided === "x") return true; // FeedMe/Reeder quirks
    return constantTimeEqual(provided, deriveWriteToken(key, userId));
  }

  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const credentials = parseGoogleLoginHeader(c.req.header("Authorization"));
    if (!credentials) return c.text("", 401);
    const key = await hmacKey();
    const s = await requireServices();
    const user = await s.users.getById(credentials.user);
    if (!user) return c.text("", 401);
    const tokens = await s.apiTokens.listHashes(user.id);
    for (const t of tokens) {
      const expected = deriveAuthSecret(key, user.id, t.tokenHash);
      // expected is "<userId>/<digest>"; credentials.secret holds just the digest
      if (
        constantTimeEqual(
          credentials.secret,
          expected.slice(user.id.length + 1),
        )
      ) {
        c.set("greaderUserId", user.id);
        await next();
        return;
      }
    }
    return c.text("", 401);
  };

  app.onError((error, c) => {
    if (error instanceof AppError) return c.text("", error.status as 400);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "greader unhandled",
        err: (error as Error).stack,
      }),
    );
    return c.text("", 500);
  });

  // --- unauthenticated ------------------------------------------------------
  app.get("/", (c) => c.text("OK"));
  app.get("/check/compatibility", (c) => c.text("OK"));

  app.post("/accounts/ClientLogin", async (c) => {
    const form = await c.req.parseBody();
    const email =
      typeof form.Email === "string" ? form.Email : c.req.query("Email");
    const passwd =
      typeof form.Passwd === "string" ? form.Passwd : c.req.query("Passwd");
    if (!email) return c.text("", 400);

    const key = await hmacKey();
    const s = await requireServices();
    const user = await s.users.getByUsername(email);
    if (!user || !passwd) return c.text("", 401);

    let tokenHash: string | null = null;
    for (const t of await s.apiTokens.listHashes(user.id)) {
      if (constantTimeEqual(t.tokenHash, sha256Hex(passwd))) {
        tokenHash = t.tokenHash;
        break;
      }
    }
    if (!tokenHash) return c.text("", 401);

    const auth = deriveAuthSecret(key, user.id, tokenHash);

    c.header("Content-Type", "text/plain; charset=UTF-8");
    return c.text(`SID=${auth}\nLSID=null\nAuth=${auth}\n`);
  });

  // --- authenticated --------------------------------------------------------
  app.use("/reader/*", auth);

  app.get("/reader/api/0/token", async (c) => {
    const key = await hmacKey();
    return c.text(writeTokenFor(key, c.get("greaderUserId")));
  });

  app.get("/reader/api/0/user-info", (c) => {
    const userId = c.get("greaderUserId");
    return c.json({
      userId,
      userName: userId,
      userProfileId: userId,
      userEmail: "",
    });
  });

  app.get("/reader/api/0/tag/list", async (c) => {
    if (c.req.query("output") !== "json") return c.text("", 501);
    const s = await requireServices();
    const userId = c.get("greaderUserId");
    const folders = await s.folders.list(userId);
    return c.json({
      tags: [
        { id: "user/-/state/com.google/starred" },
        { id: "user/-/state/com.google/reading-list" },
        ...folders.map((f) => ({
          id: `${LABEL_PREFIX}${f.name}`,
          type: "folder",
          sortid: f.name.slice(0, 8).toUpperCase().padEnd(8, "A"),
        })),
      ],
    });
  });

  app.get("/reader/api/0/subscription/list", async (c) => {
    if (c.req.query("output") !== "json") return c.text("", 501);
    const s = await requireServices();
    const subs = await s.subscriptions.list(c.get("greaderUserId"));
    return c.json({
      subscriptions: subs.map((sub) => ({
        id: `feed/${sub.feedId}`,
        title: sub.displayTitle,
        categories:
          sub.categoryId && sub.categoryName
            ? [
                {
                  id: `${LABEL_PREFIX}${sub.categoryName}`,
                  label: sub.categoryName,
                },
              ]
            : [],
        url: sub.url,
        htmlUrl: sub.siteUrl,
        iconUrl: sub.iconUrl,
        sortid: "",
        firstitemmsec: sub.newestEntryAtMs?.toString() ?? "",
        count: sub.entryCount,
      })),
    });
  });

  app.get("/reader/api/0/unread-count", async (c) => {
    if (c.req.query("output") !== "json") return c.text("", 501);
    const s = await requireServices();
    const userId = c.get("greaderUserId");
    const [byFeed, subs] = await Promise.all([
      s.entries.unreadCountsByFeed(userId),
      s.subscriptions.list(userId),
    ]);
    const unreadcounts = subs.map((sub) => {
      const counts = byFeed.get(Number(sub.feedId));
      return {
        id: `feed/${sub.feedId}`,
        count: counts?.count ?? 0,
        newestItemTimestampUsec: counts
          ? msToTimestampUsec(counts.newestMs)
          : "0",
      };
    });
    const folderRollups = new Map<
      string,
      { count: number; newestMs: number }
    >();
    for (const sub of subs) {
      if (!sub.categoryId || !sub.categoryName) continue;
      const counts = byFeed.get(Number(sub.feedId));
      if (!counts) continue;
      const existing = folderRollups.get(sub.categoryName);
      if (existing) {
        existing.count += counts.count;
        existing.newestMs = Math.max(existing.newestMs, counts.newestMs);
      } else {
        folderRollups.set(sub.categoryName, {
          count: counts.count,
          newestMs: counts.newestMs,
        });
      }
    }
    for (const [name, rollup] of folderRollups) {
      unreadcounts.push({
        id: `${LABEL_PREFIX}${name}`,
        count: rollup.count,
        newestItemTimestampUsec: msToTimestampUsec(rollup.newestMs),
      });
    }
    const total = unreadcounts
      .filter((u) => u.id.startsWith("feed/"))
      .reduce((sum, u) => sum + u.count, 0);
    unreadcounts.push({
      id: "user/-/state/com.google/reading-list",
      count: total,
      newestItemTimestampUsec: "0",
    });
    return c.json({ max: MAX_STREAM_ITEMS, maxperiod: 43200, unreadcounts });
  });

  // --- streams ----------------------------------------------------------------

  async function _resolveLabelToFolder(
    userId: string,
    name: string,
  ): Promise<number | null> {
    const s = await requireServices();
    return s.folders.findByName(userId, name);
  }

  type StreamQuery = {
    selector: StreamSelector;
    order: "asc" | "desc";
    limit: number;
    cursor?: string;
    unreadOnly: boolean;
    crawledAfter?: Date;
    crawledBefore?: Date;
  };

  function parseCommonParams(c: Context<Env>): Omit<StreamQuery, "selector"> {
    const q = c.req.query();
    const orderRaw = q.r ?? "d";
    const order = orderRaw === "o" ? ("asc" as const) : ("desc" as const);
    const limitRaw = Number(q.n ?? 20);
    return {
      order,
      limit: Math.min(
        Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1),
        MAX_STREAM_ITEMS,
      ),
      cursor: q.c || undefined,
      unreadOnly: false,
      crawledAfter: q.ot ? new Date(Number(q.ot) * 1000) : undefined,
      crawledBefore: q.nt ? new Date(Number(q.nt) * 1000) : undefined,
    };
  }

  async function listStream(
    userId: string,
    selector: StreamSelector,
    params: Omit<StreamQuery, "selector"> & { excludeRead?: boolean },
  ) {
    const s = await requireServices();
    return s.entries.list(userId, {
      stream:
        selector.type === "folder" && selector.categoryId === -1
          ? { type: "feed", feedId: -1 }
          : selector,
      unreadOnly: params.unreadOnly,
      order: params.order,
      limit: params.limit,
      cursor: params.cursor,
      crawledAfter: params.crawledAfter,
      crawledBefore: params.crawledBefore,
    });
  }

  async function itemEnvelope(
    userId: string,
    entries: Awaited<ReturnType<Services["entries"]["list"]>>["items"],
    selfHref: string,
    streamTitle: string,
    streamId: string,
  ) {
    const s = await requireServices();
    const subs = await s.subscriptions.list(userId);
    const byFeed = new Map(subs.map((sub) => [sub.feedId, sub]));
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      direction: "ltr",
      id: streamId,
      title: streamTitle,
      updated: nowSec,
      self: [{ href: selfHref }],
      items: entries.map((entry) => {
        const sub = byFeed.get(entry.feedId);
        const categories = [
          "user/-/state/com.google/reading-list",
          `feed/${entry.feedId}`,
        ];
        if (entry.isRead) categories.push("user/-/state/com.google/read");
        if (entry.isStarred) categories.push("user/-/state/com.google/starred");
        if (sub?.categoryId && sub.categoryName)
          categories.push(`${LABEL_PREFIX}${sub.categoryName}`);
        return {
          id: toLongItemId(BigInt(entry.id)),
          title: entry.title,
          crawlTimeMsec: msToCrawlTimeMsec(entry.crawledAtMs),
          timestampUsec: msToTimestampUsec(entry.publishedAtMs),
          published: Math.floor(entry.publishedAtMs / 1000),
          updated: Math.floor(entry.publishedAtMs / 1000),
          canonical: entry.url ? [{ href: entry.url }] : [],
          alternate: entry.url ? [{ href: entry.url, type: "text/html" }] : [],
          summary: { direction: "ltr", content: entry.contentHtml },
          author: entry.author,
          categories,
          origin: {
            streamId: `feed/${entry.feedId}`,
            title: sub?.displayTitle ?? "",
            htmlUrl: sub?.siteUrl ?? "",
          },
          ...(entry.enclosures.length > 0
            ? {
                enclosure: entry.enclosures.map((enc) => ({
                  href: enc.href,
                  type: enc.type,
                  length: enc.length,
                })),
              }
            : {}),
        };
      }),
      ...(streamTitle.includes("Starred") ? {} : {}),
    };
  }

  const STREAM_TITLES: Record<string, string> = {
    all: "Reading List",
    starred: "Starred items",
  };

  async function handleStreamContents(c: Context<Env>): Promise<Response> {
    const userId = c.get("greaderUserId");
    const selectorRaw = c.req.query("s");
    const pathAfter = c.req.path.replace(/^.*\/stream\/contents\/?/, "");
    const services = await requireServices();
    const selector = (await parseStreamId(
      services,
      userId,
      selectorRaw ?? (pathAfter ? decodeURIComponent(pathAfter) : "all"),
    )) ?? { type: "all" };
    const params = parseCommonParams(c);
    const xt = c.req.query("xt");
    if (xt === "user/-/state/com.google/read") params.unreadOnly = true;

    const page = await listStream(userId, selector, params);
    const key = selector.type === "starred" ? "starred" : selector.type;
    const title =
      STREAM_TITLES[key] ??
      `feed/${(selector as { feedId?: number }).feedId ?? ""}`;
    const envelope = await itemEnvelope(
      userId,
      page.items,
      c.req.url,
      title,
      selectorRaw ?? pathAfter ?? "user/-/state/com.google/reading-list",
    );
    return c.json({ ...envelope, continuation: page.nextCursor ?? undefined });
  }

  app.get("/reader/api/0/stream/contents", handleStreamContents);
  app.get("/reader/api/0/stream/contents/*", handleStreamContents);

  app.get("/reader/api/0/stream/items/ids", async (c) => {
    if (c.req.query("output") !== "json") return c.text("", 501);
    const userId = c.get("greaderUserId");
    const s = await requireServices();
    const selector = await parseStreamId(s, userId, c.req.query("s"));
    if (!selector) return c.json({ itemRefs: [] });
    const params = parseCommonParams(c);
    if (c.req.query("xt") === "user/-/state/com.google/read")
      params.unreadOnly = true;

    const page = await listStream(userId, selector, params);
    return c.json({
      itemRefs: page.items.map((e) => ({
        id: e.id,
        directStreamIds: [],
        timestampUsec: msToTimestampUsec(e.publishedAtMs),
      })),
      ...(page.nextCursor ? { continuation: page.nextCursor } : {}),
    });
  });

  app.post("/reader/api/0/stream/items/contents", async (c) => {
    const ids = await allFormValues(c, "i");
    const userId = c.get("greaderUserId");
    const numeric = ids
      .map((raw) => parseItemId(raw))
      .filter((v) => v !== null);
    const s = await requireServices();
    const items = await s.entries.getByIds(
      userId,
      numeric.map((v) => Number(v)),
    );
    const envelope = await itemEnvelope(
      userId,
      items,
      c.req.url,
      "(untitled)",
      "user/-/state/com.google/reading-list",
    );
    return c.json(envelope);
  });

  // --- mutations -----------------------------------------------------------

  async function ensureFolderByLabel(
    userId: string,
    label: string,
  ): Promise<number> {
    const s = await requireServices();
    const existing = await s.folders.findByName(userId, label);
    if (existing !== null) return existing;
    const created = await s.folders.create(userId, label);
    return Number(created.id);
  }

  function labelFromTag(tag: string): string | null {
    return tag.startsWith(LABEL_PREFIX)
      ? decodeURIComponent(tag.slice(LABEL_PREFIX.length))
      : null;
  }

  app.post("/reader/api/0/subscription/edit", async (c) => {
    const body = await c.req.parseBody();
    const ac = String(body.ac ?? "");
    const targets = await formArray(body, "s");
    const titles = await formArray(body, "t");
    const addLabel = typeof body.a === "string" ? body.a : "";
    const removeLabel = typeof body.r === "string" ? body.r : "";

    const userId = c.get("greaderUserId");
    const s = await requireServices();

    const firstTarget = targets.at(0) ?? "";
    const targetRef = firstTarget.replace(/^feed\//, "");
    const numericTarget = /^\d+$/.test(targetRef) ? Number(targetRef) : null;

    let folderId: number | null | undefined;
    if (addLabel) {
      const name = labelFromTag(addLabel);
      if (name) folderId = await ensureFolderByLabel(userId, name);
    } else if (removeLabel) {
      folderId = null;
    }

    if (ac === "subscribe") {
      const title = titles.at(0);
      const created = await s.subscriptions.subscribe(userId, targetRef, {
        title: title || undefined,
        categoryId: folderId ?? null,
      });
      logSubscription(userId, "subscribe", created.subscription.feedId);
    } else if (ac === "unsubscribe") {
      if (numericTarget === null) return c.text("", 400);
      await s.subscriptions.unsubscribe(userId, numericTarget);
      logSubscription(userId, "unsubscribe", String(numericTarget));
    } else if (ac === "edit") {
      if (numericTarget === null) return c.text("", 400);
      await s.subscriptions.edit(userId, numericTarget, {
        title: titles.at(0),
        categoryId: folderId,
      });
      logSubscription(userId, "edit", String(numericTarget));
    } else {
      return c.text("", 400);
    }
    return c.text("OK");
  });

  function logSubscription(userId: string, action: string, ref: string): void {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "greader subscription",
        userId,
        action,
        ref,
      }),
    );
  }

  app.post("/reader/api/0/subscription/quickadd", async (c) => {
    const body = await c.req
      .parseBody()
      .catch(() => ({}) as Record<string, unknown>);
    const url =
      c.req.query("quickadd") ??
      (typeof body.quickadd === "string" ? body.quickadd : "");
    const userId = c.get("greaderUserId");
    const s = await requireServices();
    try {
      const result = await s.subscriptions.subscribe(userId, url, {});
      return c.json({
        query: url,
        numResults: 1,
        streamId: `feed/${result.subscription.feedId}`,
      });
    } catch {
      return c.json({ query: url, numResults: 0 });
    }
  });

  app.post("/reader/api/0/edit-tag", async (c) => {
    const key = await hmacKey();
    const body = await c.req.parseBody();
    const userId = c.get("greaderUserId");
    if (!checkWriteToken(key, userId, String(body.T ?? "").trim())) {
      c.header("X-Reader-Google-Bad-Token", "true");
      return c.text("", 401);
    }

    const ids = (await allFormValues(c, "i"))
      .map((raw) => parseItemId(raw))
      .filter((v): v is bigint => v !== null)
      .map((v) => Number(v));
    const adds = await allFormValues(c, "a");
    const removes = await allFormValues(c, "r");
    const s = await requireServices();

    if (ids.length > 0) {
      if (adds.includes("user/-/state/com.google/read")) {
        await s.entries.setReadState(userId, ids, true);
      }
      if (removes.includes("user/-/state/com.google/read")) {
        await s.entries.setReadState(userId, ids, false);
      }
      if (adds.includes("user/-/state/com.google/starred")) {
        await s.entries.setStarred(userId, ids, true);
      }
      if (removes.includes("user/-/state/com.google/starred")) {
        await s.entries.setStarred(userId, ids, false);
      }
      // broadcast/like/tracking-kept-unread accepted and ignored (FreshRSS parity).
    }
    return c.text("OK");
  });

  app.post("/reader/api/0/rename-tag", async (c) => {
    const key = await hmacKey();
    const body = await c.req.parseBody();
    const userId = c.get("greaderUserId");
    if (!checkWriteToken(key, userId, String(body.T ?? "").trim())) {
      c.header("X-Reader-Google-Bad-Token", "true");
      return c.text("", 401);
    }
    const from = labelFromTag(String(body.s ?? ""));
    const to = labelFromTag(String(body.dest ?? ""));
    if (!from || !to) return c.text("", 400);
    const s = await requireServices();
    const id = await s.folders.findByName(userId, from);
    if (id === null) return c.text("", 400);
    await s.folders.rename(userId, id, to);
    return c.text("OK");
  });

  app.post("/reader/api/0/disable-tag", async (c) => {
    const key = await hmacKey();
    const body = await c.req.parseBody();
    const userId = c.get("greaderUserId");
    if (!checkWriteToken(key, userId, String(body.T ?? "").trim())) {
      c.header("X-Reader-Google-Bad-Token", "true");
      return c.text("", 401);
    }
    const s = await requireServices();
    for (const tag of await formArray(body, "s")) {
      const name = labelFromTag(tag);
      if (!name) continue;
      const id = await s.folders.findByName(userId, name);
      if (id !== null) await s.folders.delete(userId, id);
    }
    return c.text("OK");
  });

  app.post("/reader/api/0/mark-all-as-read", async (c) => {
    const key = await hmacKey();
    const body = await c.req.parseBody();
    const userId = c.get("greaderUserId");
    if (!checkWriteToken(key, userId, String(body.T ?? "").trim())) {
      c.header("X-Reader-Google-Bad-Token", "true");
      return c.text("", 401);
    }
    const olderThan = markAllAsReadTsToDate(String(body.ts ?? "0"));
    if (!olderThan) return c.text("", 400);
    const s = await requireServices();
    const selector = (await parseStreamId(
      s,
      userId,
      String(body.s ?? "all"),
    )) ?? {
      type: "all" as const,
    };
    await s.entries.markAllRead(userId, selector, olderThan);
    return c.text("OK");
  });

  // --- OPML ------------------------------------------------------------------
  app.get("/reader/api/0/subscription/export", async (c) => {
    const s = await requireServices();
    const userId = c.get("greaderUserId");
    const subs = await s.subscriptions.list(userId);
    const xml = await s.opml.exportOpml(userId, subs);
    c.header("Content-Type", "application/xml; charset=UTF-8");
    c.header(
      "Content-Disposition",
      'attachment; filename="sparkle-subscriptions.opml"',
    );
    return c.body(xml);
  });

  app.post("/reader/api/0/subscription/import", async (c) => {
    const raw = await c.req.text();
    if (!raw.trim()) return c.text("", 400);
    const s = await requireServices();
    const userId = c.get("greaderUserId");
    const items = await s.opml.parseImport(raw);
    for (const item of items.slice(0, 500)) {
      const categoryId =
        item.folderName !== null
          ? await s.opml.ensureFolderByName(userId, item.folderName)
          : null;
      await s.subscriptions
        .subscribeDirect(userId, item.feedUrl, {
          title: item.title,
          categoryId,
          siteUrl: item.siteUrl ?? undefined,
        })
        .catch(() => {});
    }
    return c.text("OK");
  });

  return app;
}
