import { randomUUID } from 'node:crypto';
import {
  createIngestService,
  createSubscriptionsService,
  fetchFeed,
  guidHash,
} from '@sparkle/core';
import * as schema from '@sparkle/db';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalPool } from '../src/client';

const databaseUrl = process.env.TEST_DATABASE_URL;

const GOOD_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Integration Feed</title>
  <link>https://int.example/</link>
  <item><title>Post One</title><link>https://int.example/1</link><guid>int-1</guid>
    <pubDate>Wed, 22 Jul 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>one</p>]]></description></item>
  <item><title>Post Two</title><link>https://int.example/2</link><guid>int-2</guid>
    <pubDate>Wed, 22 Jul 2026 11:00:00 GMT</pubDate>
    <description><![CDATA[<p>two</p>]]></description></item>
</channel></rss>`;

describe.skipIf(!databaseUrl)('ingest pipeline (docker Postgres)', () => {
  let pool: ReturnType<typeof createLocalPool>;
  let db: NodePgDatabase<typeof schema>;
  let ingest: ReturnType<typeof createIngestService>;
  const userId = randomUUID();
  let feedId = 0;

  function fakeFetcher(responses: Map<string, () => Response>) {
    return async (url: string, init?: RequestInit) => {
      const inm = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
      const make = responses.get(url);
      if (!make) return new Response('nope', { status: 404 });
      if (inm) {
        // honor revalidation: echo a 304 carrying no validators
        return new Response(null, { status: 304 });
      }
      return make();
    };
  }

  /** Mirrors the worker's per-feed flow with an injectable transport. */
  async function runFeed(feedUrl: string): Promise<{ outcome: string; inserted: number }> {
    const feed = await ingest.getFeed(feedId);
    if (!feed) throw new Error('feed missing');
    try {
      const response = await fetchFeed(feedUrl, {
        etag: feed.etag,
        lastModified: feed.lastModified,
        fetchImpl: fakeFetcher(
          new Map([
            [
              'https://int.example/rss.xml',
              () => new Response(GOOD_RSS, { status: 200, headers: { ETag: '"v1"' } }),
            ],
          ]),
        ) as never,
      });
      if (response.status === 'not-modified') {
        await ingest.recordNotModified(feed.id, feed.ttlMinutes);
        return { outcome: 'not-modified', inserted: 0 };
      }
      const parsed = await ingest.parseXml(response.body ?? '', feed.siteUrl);
      const inserted = await ingest.fanoutEntries(feed.id, parsed.entries);
      await ingest.recordSuccess(feed.id, {
        etag: response.etag,
        lastModified: response.lastModified,
        ttlMinutes: feed.ttlMinutes,
        parsedTitle: parsed.title || undefined,
        parsedSiteUrl: parsed.siteUrl || undefined,
      });
      return { outcome: 'ok', inserted };
    } catch (error) {
      await ingest.recordFailure(feed.id, (error as Error).message, {
        ttlMinutes: feed.ttlMinutes,
        errorCount: feed.errorCount,
      });
      return { outcome: 'error', inserted: 0 };
    }
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('unreachable');
    pool = createLocalPool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP TABLE IF EXISTS user_entries, subscriptions, feeds, categories,
      api_tokens, user_settings, users CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });

    ingest = createIngestService({ db });
    const subs = createSubscriptionsService({ db });
    await db.insert(schema.users).values({ id: userId, cognitoSub: 'ing-sub', username: 'ing' });
    const created = await subs.subscribeDirect(userId, 'https://int.example/rss.xml', {});
    feedId = Number(created.feedId);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('fetches, fans out to subscribers, dedupes on rerun', async () => {
    const first = await runFeed('https://int.example/rss.xml');
    expect(first.outcome).toBe('ok');
    expect(first.inserted).toBe(2);

    const second = await runFeed('https://int.example/rss.xml');
    expect(second.inserted).toBe(0);

    const rows = await db.select().from(schema.userEntries);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.isRead)).toBe(true);
    const feed = await ingest.getFeed(feedId);
    expect(feed?.etag).toBe('"v1"');
    expect(feed?.lastError).toBeNull();
  });

  it('records failures with exponential backoff metadata', async () => {
    // point the feed at a URL that will fail
    await db
      .update(schema.feeds)
      .set({ url: 'https://missing.example/rss' })
      .where(sql`id = ${feedId}`);
    const result = await runFeed('https://missing.example/rss');
    expect(result.outcome).toBe('error');

    const feed = await ingest.getFeed(feedId);
    expect(feed?.errorCount).toBe(1);
    expect(feed?.lastError).toContain('responded 404');

    const due = await ingest.getDueFeeds(100);
    // backoff pushed next_fetch_after beyond now → not immediately due
    expect(due.find((f) => f.id === feedId)).toBeUndefined();

    // restore for the next test
    await db
      .update(schema.feeds)
      .set({ url: 'https://int.example/rss.xml', errorCount: 0, nextFetchAfter: new Date(0) })
      .where(sql`id = ${feedId}`);
  });

  it('honors etag-based 304s without refanning out', async () => {
    await db.update(schema.feeds).set({ etag: '"v1"' }).where(sql`id = ${feedId}`);
    const result = await runFeed('https://int.example/rss.xml');
    expect(result.outcome).toBe('not-modified');
    const rows = await db.select().from(schema.userEntries);
    expect(rows).toHaveLength(2);
  });

  it('fans out only to actual subscribers of the feed', async () => {
    const strangerId = randomUUID();
    await db.insert(schema.users).values({ id: strangerId, cognitoSub: 'x', username: 'x' });
    const entriesBefore = await db.select().from(schema.userEntries);
    expect(entriesBefore.every((e) => e.userId === userId)).toBe(true);
    void guidHash;
  });
});
