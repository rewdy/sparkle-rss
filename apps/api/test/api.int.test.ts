import { randomUUID } from 'node:crypto';
import { guidHash } from '@sparkle/core';
import * as schema from '@sparkle/db';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.ALLOW_INSECURE_DEV_AUTH = 'true';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sparkle_test';

const { app } = await import('../src/app');
const { createLocalPool } = await import('@sparkle/db');

const DEV_USER = `http-user-${randomUUID().slice(0, 8)}`;
const H = { 'X-Dev-User': DEV_USER };

describe.skipIf(!process.env.TEST_DATABASE_URL)('api v1 http surface', () => {
  let pool: ReturnType<typeof createLocalPool>;
  let db: NodePgDatabase<typeof schema>;
  let feedId = 0;
  const entryIds: number[] = [];

  beforeAll(async () => {
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL required');
    pool = createLocalPool({ connectionString: testDbUrl });
    db = drizzle(pool, { schema });
    await db.execute(sql`DROP TABLE IF EXISTS user_entries, subscriptions, feeds, categories,
      api_tokens, user_settings, users CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, {
      migrationsFolder: new URL('../../../packages/db/drizzle', import.meta.url).pathname,
    });

    // identity + subscription + three entries
    await app.request('/api/v1/me', { headers: H });
    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    const userId = users[0]?.id;
    if (!userId) throw new Error('user row missing');

    await db.insert(schema.feeds).values({
      url: 'https://api-test.example/rss.xml',
      title: 'API Test Feed',
      siteUrl: 'https://api-test.example',
    });
    feedId = (await db.select().from(schema.feeds)).at(0)?.id ?? -1;
    if (feedId === -1) throw new Error('feed row missing');
    await db.insert(schema.subscriptions).values({ userId, feedId });
    for (let i = 0; i < 3; i++) {
      const rows = await db
        .insert(schema.userEntries)
        .values({
          userId,
          feedId,
          guid: `g${i}`,
          guidHash: guidHash(`g${i}`),
          title: `Entry ${i}`,
          url: `https://api-test.example/${i}`,
          publishedAt: new Date(Date.UTC(2026, 0, i + 1)),
          enclosures: [],
        })
        .returning({ id: schema.userEntries.id });
      const entryId = rows.at(0)?.id;
      if (entryId === undefined) throw new Error('entry row missing');
      entryIds.push(entryId);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('exposes an open ping', async () => {
    const res = await app.request('/api/v1/ping');
    expect(res.status).toBe(200);
  });

  it('provisions and returns the caller identity', async () => {
    const res = await app.request('/api/v1/me', { headers: H });
    const body = (await res.json()) as { username: string };
    expect(res.status).toBe(200);
    expect(body.username).toBe(DEV_USER);
  });

  it('lists folders and manages them', async () => {
    const created = await app.request('/api/v1/folders', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HTTP Folder' }),
    });
    expect(created.status).toBe(201);
    const folder = ((await created.json()) as { folder: { id: string } }).folder;

    const dup = await app.request('/api/v1/folders', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HTTP Folder' }),
    });
    expect(dup.status).toBe(409);

    const renamed = await app.request(`/api/v1/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(renamed.status).toBe(204);

    const deleted = await app.request(`/api/v1/folders/${folder.id}`, {
      method: 'DELETE',
      headers: H,
    });
    expect(deleted.status).toBe(204);
    const missing = await app.request('/api/v1/folders/999999', { method: 'DELETE', headers: H });
    expect(missing.status).toBe(404);
  });

  it('lists subscriptions', async () => {
    const res = await app.request('/api/v1/subscriptions', { headers: H });
    const body = (await res.json()) as { subscriptions: Array<{ displayTitle: string }> };
    expect(body.subscriptions[0]?.displayTitle).toBe('API Test Feed');
  });

  it('edits and removes a subscription', async () => {
    await db.insert(schema.feeds).values({ url: 'https://tmp.example/rss.xml', title: 'Tmp' });
    const tmpFeed =
      (await db.select().from(schema.feeds).where(sql`url = 'https://tmp.example/rss.xml'`)).at(0)
        ?.id ?? -1;
    if (tmpFeed === -1) throw new Error('tmp feed missing');
    const userId = (await db.select().from(schema.users)).at(0)?.id;
    if (!userId) throw new Error('user row missing');
    await db.insert(schema.subscriptions).values({ userId, feedId: tmpFeed });

    const patched = await app.request(`/api/v1/subscriptions/${tmpFeed}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Custom Name' }),
    });
    const body = (await patched.json()) as { subscription: { displayTitle: string } };
    expect(body.subscription.displayTitle).toBe('Custom Name');

    const removed = await app.request(`/api/v1/subscriptions/${tmpFeed}`, {
      method: 'DELETE',
      headers: H,
    });
    expect(removed.status).toBe(204);
  });

  it('paginates entries newest-first over http', async () => {
    const page1 = await app.request(`/api/v1/entries?limit=2&stream=feed:${feedId}`, {
      headers: H,
    });
    const p1 = (await page1.json()) as {
      items: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(p1.items.map((e) => e.title)).toEqual(['Entry 2', 'Entry 1']);

    const page2 = await app.request(
      `/api/v1/entries?limit=2&stream=feed:${feedId}&cursor=${encodeURIComponent(p1.nextCursor ?? '')}`,
      { headers: H },
    );
    const p2 = (await page2.json()) as {
      items: Array<{ title: string }>;
      nextCursor: string | null;
    };
    expect(p2.items.map((e) => e.title)).toEqual(['Entry 0']);
    expect(p2.nextCursor).toBeNull();
  });

  it('toggles read state and reports unread counts', async () => {
    const before = await app.request('/api/v1/unread-counts', { headers: H });
    const beforeBody = (await before.json()) as { total: number };
    expect(beforeBody.total).toBe(3);

    const marked = await app.request('/api/v1/entries/read', {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: entryIds.slice(0, 2), read: true }),
    });
    expect(((await marked.json()) as { updated: number }).updated).toBe(2);

    const after = await app.request('/api/v1/unread-counts', { headers: H });
    expect(((await after.json()) as { total: number }).total).toBe(1);

    const filter = await app.request('/api/v1/entries?filter=unread&stream=all', { headers: H });
    expect(((await filter.json()) as { items: unknown[] }).items).toHaveLength(1);
  });

  it('stars entries and serves the starred stream', async () => {
    const starred = await app.request('/api/v1/entries/starred', {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [entryIds[0]], starred: true }),
    });
    expect(((await starred.json()) as { updated: number }).updated).toBe(1);

    const stream = await app.request('/api/v1/entries?stream=starred', { headers: H });
    const body = (await stream.json()) as { items: Array<{ isStarred: boolean }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.isStarred).toBe(true);
  });

  it('marks a whole feed read', async () => {
    const res = await app.request('/api/v1/entries/mark-all-read', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: `feed:${feedId}` }),
    });
    expect(((await res.json()) as { updated: number }).updated).toBeGreaterThan(0);
    const counts = await app.request('/api/v1/unread-counts', { headers: H });
    expect(((await counts.json()) as { total: number }).total).toBe(0);
  });

  it('exports opml with folders intact', async () => {
    await app.request('/api/v1/folders', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ExportFolder' }),
    });
    const res = await app.request('/api/v1/opml/export', { headers: H });
    const xml = await res.text();
    expect(res.headers.get('Content-Type')).toContain('xml');
    expect(xml).toContain('xmlUrl="https://api-test.example/rss.xml"');
    expect(xml).not.toContain('ExportFolder'); // no active subscription in that folder anymore
  });

  it('round-trips settings', async () => {
    await app.request('/api/v1/settings', {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { theme: 'dark' } }),
    });
    const res = await app.request('/api/v1/settings', { headers: H });
    expect(((await res.json()) as { data: { theme: string } }).data.theme).toBe('dark');
  });

  it('mints and revokes api tokens', async () => {
    const minted = await app.request('/api/v1/me/api-tokens', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'nnw' }),
    });
    const body = (await minted.json()) as { token: string; record: { id: string } };
    expect(body.token.startsWith('srk_')).toBe(true);

    const list = await app.request('/api/v1/me/api-tokens', { headers: H });
    expect(((await list.json()) as { tokens: unknown[] }).tokens).toHaveLength(1);

    const revoked = await app.request(`/api/v1/me/api-tokens/${body.record.id}`, {
      method: 'DELETE',
      headers: H,
    });
    expect(revoked.status).toBe(204);

    const empty = await app.request('/api/v1/me/api-tokens', { headers: H });
    expect(((await empty.json()) as { tokens: unknown[] }).tokens).toHaveLength(0);
  });

  it('validates payloads with 400s', async () => {
    const bad = await app.request('/api/v1/entries/read', {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 'nope', read: true }),
    });
    expect(bad.status).toBe(400);
    const badStream = await app.request('/api/v1/entries?stream=bogus', { headers: H });
    expect(badStream.status).toBe(400);
  });
});
