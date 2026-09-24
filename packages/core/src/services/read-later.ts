import { createHash } from "node:crypto";
import * as schema from "@sparkle/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type ExtractedArticle,
  fetchAndExtractArticle,
} from "../article/fetch-article";
import { decodeCursor, encodeCursor } from "../greader/cursor";
import {
  createEntriesService,
  type EntryDto,
  type ServicesDeps,
} from "./entries";
import { AppError } from "./errors";

/** Injectable so tests (and the worker later) can stub article fetching. */
export type ArticleFetcher = (url: string) => Promise<ExtractedArticle>;

export interface ReadLaterServiceDeps extends ServicesDeps {
  articleFetcher?: ArticleFetcher;
}

export type ReadLaterSource = "entry" | "url";
export type ReadLaterStatus = "pending" | "ready" | "error";

/**
 * A saved item in the read-later queue. The shape mirrors `EntryDto` so the
 * existing list and reading-pane components can render it, with the extra
 * fields describing where the item came from.
 */
export interface ReadLaterItemDto {
  id: string;
  source: ReadLaterSource;
  entryId: string | null;
  url: string;
  title: string;
  author: string;
  siteName: string;
  excerpt: string;
  contentHtml: string;
  imageUrl: string;
  status: ReadLaterStatus;
  error: string | null;
  isRead: boolean;
  isStarred: boolean;
  /** Source publish time, falling back to the save time when unknown. */
  publishedAtMs: number;
  savedAtMs: number;
  enclosures: Array<{ href?: string; type?: string; length?: number }>;
  articleImage: EntryDto["articleImage"];
}

export interface ListReadLaterQuery {
  limit?: number;
  cursor?: string;
}

export interface SaveUrlInput {
  url: string;
  title?: string;
  author?: string;
  siteName?: string;
  excerpt?: string;
  contentHtml?: string;
  imageUrl?: string;
  publishedAt?: Date | null;
  status?: ReadLaterStatus;
  error?: string | null;
}

const MAX_LIMIT = 200;

/** Query params that never change which article a URL points at. */
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "mc_eid", "igshid"]);

/**
 * Canonical form of a saved URL: used both for dedupe and for display. Only
 * normalizations that cannot change the resource are applied, so two saves of
 * the same article collapse into one item while distinct articles stay apart.
 */
export function normalizeArticleUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new AppError(400, "invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "unsupported url scheme");
  }
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith("utm_") ||
      TRACKING_PARAMS.has(key.toLowerCase())
    ) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  const query = parsed.searchParams.toString();
  return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}${query ? `?${query}` : ""}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function entryDedupeHash(entryId: number): string {
  return hash(`entry:${entryId}`);
}

export function urlDedupeHash(normalizedUrl: string): string {
  return hash(`url:${normalizedUrl}`);
}

export function createReadLaterService({
  db,
  articleFetcher = fetchAndExtractArticle,
}: ReadLaterServiceDeps) {
  const entries = createEntriesService({ db });

  function toDto(
    row: typeof schema.readLaterItems.$inferSelect,
    entry: EntryDto | undefined,
  ): ReadLaterItemDto {
    if (row.entryId === null) {
      return {
        id: row.id,
        source: "url",
        entryId: null,
        url: row.url,
        title: row.title,
        author: row.author,
        siteName: row.siteName,
        excerpt: row.excerpt,
        contentHtml: row.contentHtml,
        imageUrl: row.imageUrl,
        status: row.status as ReadLaterStatus,
        error: row.error,
        isRead: row.isRead,
        isStarred: false,
        publishedAtMs: row.publishedAt?.getTime() ?? row.savedAt.getTime(),
        savedAtMs: row.savedAt.getTime(),
        enclosures: [],
        articleImage: null,
      };
    }
    // The entry row is the source of truth while it exists; the snapshot on the
    // saved row keeps the item listable (and unlinkable, not broken) after the
    // user unsubscribes and the entry is deleted.
    return {
      id: row.id,
      source: "entry",
      entryId: row.entryId.toString(),
      url: entry?.url ?? row.url,
      title: entry?.title ?? row.title,
      author: entry?.author ?? row.author,
      siteName: row.siteName,
      excerpt: row.excerpt,
      contentHtml: entry?.contentHtml ?? "",
      imageUrl: row.imageUrl,
      status: entry ? (row.status as ReadLaterStatus) : "error",
      error: entry
        ? row.error
        : (row.error ?? "the original article is no longer available"),
      // An item whose entry is gone cannot be opened, so it is reported read
      // rather than left as a permanently unread entry in the queue (this also
      // matches how `count` treats orphans).
      isRead: entry ? entry.isRead : true,
      isStarred: entry?.isStarred ?? false,
      publishedAtMs:
        entry?.publishedAtMs ??
        row.publishedAt?.getTime() ??
        row.savedAt.getTime(),
      savedAtMs: row.savedAt.getTime(),
      enclosures: entry?.enclosures ?? [],
      articleImage: entry?.articleImage ?? null,
    };
  }

  async function decorate(
    userId: string,
    rows: (typeof schema.readLaterItems.$inferSelect)[],
  ): Promise<ReadLaterItemDto[]> {
    const entryIds = rows
      .map((row) => row.entryId)
      .filter((id): id is number => id !== null);
    const byId = new Map<string, EntryDto>();
    if (entryIds.length > 0) {
      for (const entry of await entries.getByIds(userId, entryIds)) {
        byId.set(entry.id, entry);
      }
    }
    return rows.map((row) =>
      toDto(
        row,
        row.entryId === null ? undefined : byId.get(row.entryId.toString()),
      ),
    );
  }

  return {
    async list(
      userId: string,
      query: ListReadLaterQuery = {},
    ): Promise<{ items: ReadLaterItemDto[]; nextCursor: string | null }> {
      const cursor = query.cursor
        ? decodeCursor(query.cursor, { sortKey: "saved", direction: "desc" })
        : null;
      if (query.cursor !== undefined && cursor === null) {
        throw new AppError(400, "invalid cursor");
      }

      const conditions = [eq(schema.readLaterItems.userId, userId)];
      if (cursor) {
        const at = new Date(cursor.primaryAtMs).toISOString();
        // Parenthesized: drizzle does not wrap raw SQL chunks, so an unparenthesized
        // `or` here would escape the user-scope condition and could page in another
        // user's items.
        conditions.push(
          sql`(${schema.readLaterItems.savedAt} < ${at} or (${schema.readLaterItems.savedAt} = ${at} and ${schema.readLaterItems.id} < ${cursor.entryId}))`,
        );
      }

      const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
      const rows = await db
        .select()
        .from(schema.readLaterItems)
        .where(and(...conditions))
        .orderBy(
          desc(schema.readLaterItems.savedAt),
          desc(schema.readLaterItems.id),
        )
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: await decorate(userId, page),
        nextCursor:
          hasMore && last
            ? encodeCursor({
                sortKey: "saved",
                direction: "desc",
                primaryAtMs: last.savedAt.getTime(),
                entryId: last.id,
              })
            : null,
      };
    },

    async getByIds(userId: string, ids: string[]): Promise<ReadLaterItemDto[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(schema.readLaterItems)
        .where(
          and(
            eq(schema.readLaterItems.userId, userId),
            inArray(schema.readLaterItems.id, ids),
          ),
        );
      return decorate(userId, rows);
    },

    /** Entry ids currently in the user's queue, for decorating entry payloads. */
    async entryIdsInQueue(
      userId: string,
      entryIds: number[],
    ): Promise<Set<number>> {
      if (entryIds.length === 0) return new Set();
      const rows = await db
        .select({ entryId: schema.readLaterItems.entryId })
        .from(schema.readLaterItems)
        .where(
          and(
            eq(schema.readLaterItems.userId, userId),
            inArray(schema.readLaterItems.entryId, entryIds),
          ),
        );
      return new Set(
        rows
          .map((row) => row.entryId)
          .filter((id): id is number => id !== null),
      );
    },

    /**
     * Adds or removes feed entries from the queue. Entry ownership is checked
     * first, so a caller cannot add another user's entry by guessing an id.
     */
    async saveEntries(
      userId: string,
      entryIds: number[],
      save: boolean,
    ): Promise<number> {
      if (entryIds.length === 0) return 0;
      const owned = await db
        .select({
          id: schema.userEntries.id,
          url: schema.userEntries.url,
          title: schema.userEntries.title,
          publishedAt: schema.userEntries.publishedAt,
        })
        .from(schema.userEntries)
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            inArray(schema.userEntries.id, entryIds),
          ),
        );
      if (owned.length === 0) return 0;
      const ownedIds = owned.map((row) => row.id);

      if (!save) {
        const deleted = await db
          .delete(schema.readLaterItems)
          .where(
            and(
              eq(schema.readLaterItems.userId, userId),
              inArray(schema.readLaterItems.entryId, ownedIds),
            ),
          )
          .returning({ id: schema.readLaterItems.id });
        return deleted.length;
      }

      const inserted = await db
        .insert(schema.readLaterItems)
        .values(
          owned.map((row) => ({
            id: crypto.randomUUID(),
            userId,
            entryId: row.id,
            url: row.url,
            title: row.title,
            publishedAt: row.publishedAt,
            // Set from the app rather than the column default so `saved_at`
            // never carries sub-millisecond precision the keyset cursor
            // cannot represent (ties are broken by id).
            savedAt: new Date(),
            dedupeHash: entryDedupeHash(row.id),
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.readLaterItems.userId,
            schema.readLaterItems.dedupeHash,
          ],
        })
        .returning({ id: schema.readLaterItems.id });
      return inserted.length;
    },

    /** Saves an off-feed article. Re-saving an article returns the existing item. */
    async saveUrl(
      userId: string,
      input: SaveUrlInput,
    ): Promise<ReadLaterItemDto> {
      const url = normalizeArticleUrl(input.url);
      const savedAt = new Date();
      const rows = await db
        .insert(schema.readLaterItems)
        .values({
          id: crypto.randomUUID(),
          userId,
          url,
          title: input.title ?? "",
          author: input.author ?? "",
          siteName: input.siteName ?? "",
          excerpt: input.excerpt ?? "",
          contentHtml: input.contentHtml ?? "",
          imageUrl: input.imageUrl ?? "",
          status: input.status ?? "ready",
          error: input.error ?? null,
          publishedAt: input.publishedAt ?? null,
          // App-supplied: see the note on saveEntries above.
          savedAt,
          dedupeHash: urlDedupeHash(url),
        })
        .onConflictDoUpdate({
          target: [
            schema.readLaterItems.userId,
            schema.readLaterItems.dedupeHash,
          ],
          set: {
            title: input.title ?? "",
            author: input.author ?? "",
            siteName: input.siteName ?? "",
            excerpt: input.excerpt ?? "",
            contentHtml: input.contentHtml ?? "",
            imageUrl: input.imageUrl ?? "",
            status: input.status ?? "ready",
            error: input.error ?? null,
            publishedAt: input.publishedAt ?? null,
            // Re-saving bumps the item back to the top of the queue.
            savedAt,
          },
        })
        .returning();
      const row = rows.at(0);
      if (!row) throw new AppError(500, "failed to save article");
      return toDto(row, undefined);
    },

    /**
     * Saves an off-feed article, fetching a readable copy of the page first.
     * A blocked or malformed URL is the user's mistake and fails loudly; any
     * other fetch/extraction problem still saves the link (status `error`) so
     * the article is never silently lost.
     */
    async saveUrlWithExtraction(
      userId: string,
      input: { url: string; title?: string; excerpt?: string },
    ): Promise<ReadLaterItemDto> {
      let article: ExtractedArticle;
      try {
        article = await articleFetcher(input.url);
      } catch (error) {
        if (error instanceof AppError && error.status === 400) throw error;
        return await this.saveUrl(userId, {
          url: input.url,
          title: input.title ?? "",
          excerpt: input.excerpt ?? "",
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "could not fetch that page",
        });
      }
      return await this.saveUrl(userId, {
        // Store the post-redirect URL: it is what the reader should open.
        url: article.url,
        title: input.title?.trim() || article.title,
        author: article.byline,
        siteName: article.siteName,
        excerpt: input.excerpt?.trim() || article.excerpt,
        contentHtml: article.contentHtml,
        imageUrl: article.imageUrl,
        publishedAt: article.publishedAt,
        status: "ready",
      });
    },

    /**
     * Marks items read. Feed-sourced items delegate to the entry's own read
     * state so the two lists never disagree about the same article.
     */
    async setReadState(
      userId: string,
      ids: string[],
      read: boolean,
    ): Promise<number> {
      if (ids.length === 0) return 0;
      const rows = await db
        .select({
          id: schema.readLaterItems.id,
          entryId: schema.readLaterItems.entryId,
        })
        .from(schema.readLaterItems)
        .where(
          and(
            eq(schema.readLaterItems.userId, userId),
            inArray(schema.readLaterItems.id, ids),
          ),
        );
      const savedIds = rows
        .filter((row) => row.entryId === null)
        .map((row) => row.id);
      const entryIds = rows
        .map((row) => row.entryId)
        .filter((id): id is number => id !== null);

      if (savedIds.length > 0) {
        await db
          .update(schema.readLaterItems)
          .set({ isRead: read, readAt: read ? new Date() : null })
          .where(
            and(
              eq(schema.readLaterItems.userId, userId),
              inArray(schema.readLaterItems.id, savedIds),
            ),
          );
      }
      if (entryIds.length > 0) {
        await entries.setReadState(userId, entryIds, read);
      }
      return rows.length;
    },

    async remove(userId: string, ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const deleted = await db
        .delete(schema.readLaterItems)
        .where(
          and(
            eq(schema.readLaterItems.userId, userId),
            inArray(schema.readLaterItems.id, ids),
          ),
        )
        .returning({ id: schema.readLaterItems.id });
      return deleted.length;
    },

    async count(userId: string): Promise<{ total: number; unread: number }> {
      const [totals, unread] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.readLaterItems)
          .where(eq(schema.readLaterItems.userId, userId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.readLaterItems)
          .leftJoin(
            schema.userEntries,
            and(
              eq(schema.userEntries.id, schema.readLaterItems.entryId),
              eq(schema.userEntries.userId, schema.readLaterItems.userId),
            ),
          )
          .where(
            and(
              eq(schema.readLaterItems.userId, userId),
              // Orphaned entry-sourced items cannot be opened, so they never
              // count as unread (otherwise the badge sticks forever).
              // Parenthesized: drizzle does not wrap raw SQL chunks, so an
              // unparenthesized `or` would escape the user-scope condition.
              sql`((${schema.readLaterItems.entryId} is null and ${schema.readLaterItems.isRead} = false) or (${schema.userEntries.id} is not null and ${schema.userEntries.isRead} = false))`,
            ),
          ),
      ]);
      return {
        total: totals.at(0)?.count ?? 0,
        unread: unread.at(0)?.count ?? 0,
      };
    },
  };
}
