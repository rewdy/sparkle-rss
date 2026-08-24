import { describe, expect, it } from 'vitest';
import { fetchFeed } from '../src/feed/fetch-feed';
import { backoffMinutes } from '../src/services/ingest';

function jsonResponse(_url: string, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe('fetchFeed', () => {
  it('sends conditional headers and reports not-modified', async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      seenHeaders = { ...(init?.headers ?? {}) } as Record<string, string>;
      if (seenHeaders['If-None-Match'] === '"abc"') {
        return new Response(null, { status: 304 });
      }
      return jsonResponse(url, '<rss/>', { ETag: '"abc"' });
    };

    const first = await fetchFeed('https://f.example/rss', { fetchImpl: fetchImpl as never });
    expect(first.status).toBe('ok');
    expect(first.etag).toBe('"abc"');

    const second = await fetchFeed('https://f.example/rss', {
      etag: first.etag,
      fetchImpl: fetchImpl as never,
    });
    expect(second.status).toBe('not-modified');
    expect(seenHeaders['If-None-Match']).toBe('"abc"');
  });

  it('follows redirects and flags all-permanent chains', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(String(url));
      if (url === 'https://old.example/rss')
        return new Response(null, {
          status: 301,
          headers: { Location: 'https://new.example/rss' },
        });
      return jsonResponse(url, '<rss/>');
    };

    const result = await fetchFeed('https://old.example/rss', { fetchImpl: fetchImpl as never });
    expect(calls).toEqual(['https://old.example/rss', 'https://new.example/rss']);
    expect(result.finalUrl).toBe('https://new.example/rss');
    expect(result.permanentRedirectTo).toBe('https://new.example/rss');
  });

  it('does not flag temporary redirects as permanent', async () => {
    const fetchImpl = async (url: string) => {
      if (url === 'https://tmp.example/rss')
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://new.example/rss' },
        });
      return jsonResponse(url, '<rss/>');
    };
    const result = await fetchFeed('https://tmp.example/rss', { fetchImpl: fetchImpl as never });
    expect(result.permanentRedirectTo).toBeUndefined();
    expect(result.finalUrl).toBe('https://new.example/rss');
  });

  it('maps HTTP failures to AppError with upstream status', async () => {
    const fetchImpl = async () => new Response('nope', { status: 404 });
    await expect(
      fetchFeed('https://x.example/rss', { fetchImpl: fetchImpl as never }),
    ).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('backoffMinutes', () => {
  it('doubles per error and caps at 24h', () => {
    expect(backoffMinutes(60, 0)).toBe(60);
    expect(backoffMinutes(60, 1)).toBe(120);
    expect(backoffMinutes(60, 3)).toBe(480);
    expect(backoffMinutes(60, 12)).toBe(1440);
  });
});
