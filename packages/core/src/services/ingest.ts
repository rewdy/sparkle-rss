import * as schema from '@sparkle/db';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FetchFeedResult } from '../feed/fetch-feed';
import type { ParsedEntry } from '../feed/parse';
import { parseFeed } from '../feed/parse';
import { insertEntriesForUser } from './subscriptions';

export interface ServicesDeps {
  db: NodePgDatabase<typeof schema>;
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

export function createIngestService({ db }: ServicesDeps) {
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
        .set({ nextFetchAfter: sql`now() + (${schema.feeds.ttlMinutes} * interval '1 minute')` })
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
      result: Pick<FetchFeedResult, 'etag' | 'lastModified'> & {
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
      await db.update(schema.feeds).set(patch).where(eq(schema.feeds.id, feedId));
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

    async fanoutEntries(feedId: number, entries: ParsedEntry[]): Promise<number> {
      const subscribers = await this.subscriberIds(feedId);
      let inserted = 0;
      for (const userId of subscribers) {
        inserted += await insertEntriesForUser(db, userId, feedId, entries);
      }
      return inserted;
    },

    parseXml(xml: string, fallbackSiteUrl: string) {
      return parseFeed(xml, fallbackSiteUrl);
    },
  };
}
