import * as schema from "@sparkle/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FetchFeedResult } from "../feed/fetch-feed";
import type { ParsedEntry } from "../feed/parse";
import { parseFeed } from "../feed/parse";
import { guidHash, insertEntriesForUser } from "./subscriptions";

export interface ServicesDeps {
  db: NodePgDatabase<typeof schema>;
  media?: {
    attachSplash(
      userId: string,
      entryId: number,
      image: NonNullable<ParsedEntry["articleImage"]>,
    ): Promise<string>;
  };
}

const MAX_BACKOFF_MINUTES = 24 * 60;
const QUARANTINE_ERROR_COUNT = 50;

export function backoffMinutes(ttlMinutes: number, errorCount: number): number {
  const scaled = ttlMinutes * 2 ** Math.min(errorCount, 10);
  return Math.min(Math.round(scaled), MAX_BACKOFF_MINUTES);
}

export interface FeedRow {
  id: number;
  url: string;
  title: string;
  siteUrl: string;
  etag: string | null;
  lastModified: string | null;
  ttlMinutes: number;
  errorCount: number;
  lastError: string | null;
}

export function createIngestService({ db, media }: ServicesDeps) {
  return {
    async getDueFeeds(limit: number): Promise<FeedRow[]> {
      const rows = await db
        .select({
          id: schema.feeds.id,
          url: schema.feeds.url,
          title: schema.feeds.title,
          siteUrl: schema.feeds.siteUrl,
          etag: schema.feeds.etag,
          lastModified: schema.feeds.lastModified,
          ttlMinutes: schema.feeds.ttlMinutes,
          errorCount: schema.feeds.errorCount,
          lastError: schema.feeds.lastError,
        })
        .from(schema.feeds)
        .where(
          and(
            lte(schema.feeds.nextFetchAfter, sql`now()`),
            sql`${schema.feeds.errorCount} < ${QUARANTINE_ERROR_COUNT}`,
            sql`exists (
              select 1 from ${schema.subscriptions}
              where ${schema.subscriptions.feedId} = ${schema.feeds.id}
            )`,
          ),
        )
        .orderBy(schema.feeds.nextFetchAfter)
        .limit(limit);
      return rows;
    },

    /** Bump next_fetch_after while the message sits in the queue (claim). */
    async claimFeeds(ids: number[]): Promise<void> {
      if (ids.length === 0) return;
      await db
        .update(schema.feeds)
        .set({
          nextFetchAfter: sql`now() + (${schema.feeds.ttlMinutes} * interval '1 minute')`,
        })
        .where(inArray(schema.feeds.id, ids));
    },

    async getFeed(feedId: number): Promise<FeedRow | null> {
      const rows = await db
        .select({
          id: schema.feeds.id,
          url: schema.feeds.url,
          title: schema.feeds.title,
          siteUrl: schema.feeds.siteUrl,
          etag: schema.feeds.etag,
          lastModified: schema.feeds.lastModified,
          ttlMinutes: schema.feeds.ttlMinutes,
          errorCount: schema.feeds.errorCount,
          lastError: schema.feeds.lastError,
        })
        .from(schema.feeds)
        .where(eq(schema.feeds.id, feedId));
      return rows.at(0) ?? null;
    },

    /** Remove feeds that have had no subscribers for the grace period. */
    async cleanupOrphanedFeeds(
      graceMinutes = 72 * 60,
      limit = 100,
    ): Promise<number> {
      const cutoff = new Date(Date.now() - graceMinutes * 60_000);
      const candidates = await db
        .select({ id: schema.feeds.id })
        .from(schema.feeds)
        .where(
          and(
            lte(schema.feeds.orphanedAt, cutoff),
            sql`not exists (
              select 1 from ${schema.subscriptions}
              where ${schema.subscriptions.feedId} = ${schema.feeds.id}
            )`,
          ),
        )
        .limit(limit);

      let removed = 0;
      for (const feed of candidates) {
        await db
          .delete(schema.userMedia)
          .where(
            sql`${schema.userMedia.entryId} in (select id from ${schema.userEntries} where ${schema.userEntries.feedId} = ${feed.id})`,
          );
        await db
          .delete(schema.userEntries)
          .where(eq(schema.userEntries.feedId, feed.id));
        const deleted = await db
          .delete(schema.feeds)
          .where(
            and(
              eq(schema.feeds.id, feed.id),
              lte(schema.feeds.orphanedAt, cutoff),
              sql`not exists (
                select 1 from ${schema.subscriptions}
                where ${schema.subscriptions.feedId} = ${schema.feeds.id}
              )`,
            ),
          )
          .returning({ id: schema.feeds.id });
        removed += deleted.length;
      }
      return removed;
    },

    async recordNotModified(feedId: number, ttlMinutes: number): Promise<void> {
      await db
        .update(schema.feeds)
        .set({
          lastFetchedAt: new Date(),
          nextFetchAfter: sql`now() + (${ttlMinutes} * interval '1 minute')`,
          errorCount: 0,
          lastError: null,
        })
        .where(eq(schema.feeds.id, feedId));
    },

    async recordSuccess(
      feedId: number,
      result: Pick<FetchFeedResult, "etag" | "lastModified"> & {
        ttlMinutes: number;
        parsedTitle?: string;
        parsedSiteUrl?: string;
        parsedIconUrl?: string;
        permanentRedirectTo?: string;
      },
    ): Promise<void> {
      const patch: Partial<typeof schema.feeds.$inferInsert> = {
        etag: result.etag ?? null,
        lastModified: result.lastModified ?? null,
        lastFetchedAt: new Date(),
        errorCount: 0,
        lastError: null,
        nextFetchAfter: new Date(Date.now() + result.ttlMinutes * 60_000),
      };
      if (result.parsedTitle) patch.title = result.parsedTitle;
      if (result.parsedSiteUrl) patch.siteUrl = result.parsedSiteUrl;
      if (result.parsedIconUrl) patch.iconUrl = result.parsedIconUrl;
      if (result.permanentRedirectTo) {
        // Only adopt the redirect target when no other feed already claims it.
        const clash = await db
          .select({ id: schema.feeds.id })
          .from(schema.feeds)
          .where(eq(schema.feeds.url, result.permanentRedirectTo));
        if (clash.every((c) => c.id === feedId)) {
          patch.url = result.permanentRedirectTo;
        }
      }
      await db
        .update(schema.feeds)
        .set(patch)
        .where(eq(schema.feeds.id, feedId));
    },

    async recordFailure(
      feedId: number,
      message: string,
      opts: { ttlMinutes: number; errorCount: number },
    ): Promise<void> {
      const minutes = backoffMinutes(opts.ttlMinutes, opts.errorCount);
      await db
        .update(schema.feeds)
        .set({
          errorCount: opts.errorCount + 1,
          lastError: message.slice(0, 500),
          nextFetchAfter: new Date(Date.now() + minutes * 60_000),
          lastFetchedAt: new Date(),
        })
        .where(eq(schema.feeds.id, feedId));
    },

    async subscriberIds(feedId: number): Promise<string[]> {
      const rows = await db
        .select({ userId: schema.subscriptions.userId })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.feedId, feedId));
      return rows.map((r) => r.userId);
    },

    async fanoutEntries(
      feedId: number,
      entries: ParsedEntry[],
    ): Promise<number> {
      const subscribers = await this.subscriberIds(feedId);
      let inserted = 0;
      for (const userId of subscribers) {
        inserted += await insertEntriesForUser(db, userId, feedId, entries);
        if (media) {
          for (const entry of entries) {
            if (!entry.articleImage) continue;
            const row = (
              await db
                .select({ id: schema.userEntries.id })
                .from(schema.userEntries)
                .where(
                  and(
                    eq(schema.userEntries.userId, userId),
                    eq(schema.userEntries.feedId, feedId),
                    eq(schema.userEntries.guidHash, guidHash(entry.guid)),
                  ),
                )
            ).at(0);
            if (row)
              await media.attachSplash(userId, row.id, entry.articleImage);
          }
        }
      }
      return inserted;
    },

    parseXml(xml: string, fallbackSiteUrl: string) {
      return parseFeed(xml, fallbackSiteUrl);
    },
  };
}
