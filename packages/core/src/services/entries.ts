import * as schema from "@sparkle/db";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decodeCursor, encodeCursor } from "../greader/cursor";
import { AppError } from "./errors";

export interface ServicesDeps {
  db: NodePgDatabase<typeof schema>;
}

export type StreamSelector =
  | { type: "all" }
  | { type: "starred" }
  | { type: "feed"; feedId: number }
  | { type: "folder"; categoryId: number };

export interface ListEntriesQuery {
  stream: StreamSelector;
  unreadOnly?: boolean;
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string;
  crawledAfter?: Date;
  crawledBefore?: Date;
  publishedFrom?: Date;
}

export interface EntryDto {
  id: string;
  feedId: string;
  title: string;
  url: string;
  author: string;
  contentHtml: string;
  publishedAtMs: number;
  crawledAtMs: number;
  enclosures: Array<{ href?: string; type?: string; length?: number }>;
  isRead: boolean;
  isStarred: boolean;
  articleImage: {
    id: string;
    width: number;
    height: number;
    alt: string;
  } | null;
}

const MAX_LIMIT = 200;

export function createEntriesService({ db }: ServicesDeps) {
  function baseWhere(userId: string, stream: StreamSelector) {
    const conditions = [eq(schema.userEntries.userId, userId)];
    if (stream.type === "feed") {
      conditions.push(eq(schema.userEntries.feedId, stream.feedId));
    }
    if (stream.type === "folder") {
      const folderFeeds = db
        .select({ id: schema.subscriptions.feedId })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.userId, userId),
            eq(schema.subscriptions.categoryId, stream.categoryId),
          ),
        );
      conditions.push(inArray(schema.userEntries.feedId, folderFeeds));
    }
    return and(...conditions);
  }

  async function toEntryDtos(
    userId: string,
    rows: (typeof schema.userEntries.$inferSelect)[],
  ): Promise<EntryDto[]> {
    const ids = rows.map((row) => row.id);
    const mediaRows = ids.length
      ? await db
          .select({
            entryId: schema.userMedia.entryId,
            id: schema.mediaObjects.id,
            width: schema.mediaObjects.width,
            height: schema.mediaObjects.height,
            alt: schema.userMedia.alt,
          })
          .from(schema.userMedia)
          .innerJoin(
            schema.mediaObjects,
            eq(schema.mediaObjects.id, schema.userMedia.mediaObjectId),
          )
          .where(
            and(
              eq(schema.userMedia.userId, userId),
              eq(schema.userMedia.kind, "article_splash"),
              inArray(schema.userMedia.entryId, ids),
            ),
          )
      : [];
    const byEntry = new Map(mediaRows.map((row) => [row.entryId, row]));
    return rows.map((row) => {
      const image = byEntry.get(row.id);
      return {
        id: row.id.toString(),
        feedId: row.feedId.toString(),
        title: row.title,
        url: row.url,
        author: row.author,
        contentHtml: row.contentHtml,
        publishedAtMs: row.publishedAt.getTime(),
        crawledAtMs: row.crawledAt.getTime(),
        enclosures: (row.enclosures as EntryDto["enclosures"]) ?? [],
        isRead: row.isRead,
        isStarred: row.isStarred,
        articleImage: image
          ? {
              id: image.id,
              width: image.width,
              height: image.height,
              alt: image.alt,
            }
          : null,
      };
    });
  }

  return {
    async list(
      userId: string,
      query: ListEntriesQuery,
    ): Promise<{ items: EntryDto[]; nextCursor: string | null }> {
      const order = query.order ?? "desc";
      const starredStream = query.stream.type === "starred";
      const sortKey = starredStream
        ? ("starred" as const)
        : ("published" as const);

      if (
        query.cursor !== undefined &&
        decodeCursor(query.cursor, { sortKey, direction: order }) === null
      ) {
        throw new AppError(400, "invalid cursor");
      }

      const conditions = [baseWhere(userId, query.stream)];
      if (query.unreadOnly && !starredStream) {
        conditions.push(eq(schema.userEntries.isRead, false));
      }
      if (starredStream) {
        conditions.push(eq(schema.userEntries.isStarred, true));
      }
      if (query.crawledAfter) {
        conditions.push(gte(schema.userEntries.crawledAt, query.crawledAfter));
      }
      if (query.crawledBefore) {
        conditions.push(lte(schema.userEntries.crawledAt, query.crawledBefore));
      }
      if (query.publishedFrom) {
        conditions.push(
          gte(schema.userEntries.publishedAt, query.publishedFrom),
        );
      }

      const primary = starredStream
        ? schema.userEntries.starredAt
        : schema.userEntries.publishedAt;
      const cursor = query.cursor
        ? decodeCursor(query.cursor, { sortKey, direction: order })
        : null;
      if (cursor) {
        const at = new Date(cursor.primaryAtMs);
        const id = Number(cursor.entryId);
        conditions.push(
          order === "desc"
            ? sql`${primary} < ${at.toISOString()} or (${primary} = ${at.toISOString()} and ${schema.userEntries.id} < ${id})`
            : sql`${primary} > ${at.toISOString()} or (${primary} = ${at.toISOString()} and ${schema.userEntries.id} > ${id})`,
        );
      }

      const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
      const rows = await db
        .select()
        .from(schema.userEntries)
        .where(and(...conditions))
        .orderBy(
          order === "desc" ? desc(primary) : asc(primary),
          order === "desc"
            ? desc(schema.userEntries.id)
            : asc(schema.userEntries.id),
        )
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              sortKey,
              direction: order,
              primaryAtMs: (starredStream
                ? (last.starredAt ?? last.publishedAt)
                : last.publishedAt
              ).getTime(),
              entryId: last.id.toString(),
            })
          : null;

      return { items: await toEntryDtos(userId, page), nextCursor };
    },

    async getByIds(userId: string, ids: number[]): Promise<EntryDto[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(schema.userEntries)
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            inArray(schema.userEntries.id, ids),
          ),
        );
      return toEntryDtos(userId, rows);
    },

    async setReadState(
      userId: string,
      ids: number[],
      read: boolean,
    ): Promise<number> {
      if (ids.length === 0) return 0;
      const updated = await db
        .update(schema.userEntries)
        .set({ isRead: read, readAt: read ? new Date() : null })
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            inArray(schema.userEntries.id, ids),
          ),
        )
        .returning({ id: schema.userEntries.id });
      return updated.length;
    },

    async setStarred(
      userId: string,
      ids: number[],
      starred: boolean,
    ): Promise<number> {
      if (ids.length === 0) return 0;
      const updated = await db
        .update(schema.userEntries)
        .set({ isStarred: starred, starredAt: starred ? new Date() : null })
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            inArray(schema.userEntries.id, ids),
          ),
        )
        .returning({ id: schema.userEntries.id });
      return updated.length;
    },

    async markAllRead(
      userId: string,
      stream: StreamSelector,
      olderThan: Date,
    ): Promise<number> {
      const conditions = [
        eq(schema.userEntries.userId, userId),
        eq(schema.userEntries.isRead, false),
        lte(schema.userEntries.publishedAt, olderThan),
      ];
      if (stream.type === "feed") {
        conditions.push(eq(schema.userEntries.feedId, stream.feedId));
      } else if (stream.type === "folder") {
        const folderFeeds = db
          .select({ id: schema.subscriptions.feedId })
          .from(schema.subscriptions)
          .where(
            and(
              eq(schema.subscriptions.userId, userId),
              eq(schema.subscriptions.categoryId, stream.categoryId),
            ),
          );
        conditions.push(inArray(schema.userEntries.feedId, folderFeeds));
      }
      const updated = await db
        .update(schema.userEntries)
        .set({ isRead: true, readAt: new Date() })
        .where(and(...conditions))
        .returning({ id: schema.userEntries.id });
      return updated.length;
    },

    async unreadCountsByFeed(
      userId: string,
    ): Promise<Map<number, { count: number; newestMs: number }>> {
      const rows = await db
        .select({
          feedId: schema.userEntries.feedId,
          count: sql<number>`count(*)::int`,
          newest: sql<Date>`max(${schema.userEntries.publishedAt})`,
        })
        .from(schema.userEntries)
        .where(
          and(
            eq(schema.userEntries.userId, userId),
            eq(schema.userEntries.isRead, false),
          ),
        )
        .groupBy(schema.userEntries.feedId);
      const map = new Map<number, { count: number; newestMs: number }>();
      for (const r of rows) {
        map.set(r.feedId, {
          count: Number(r.count),
          newestMs: new Date(r.newest).getTime(),
        });
      }
      return map;
    },
  };
}
