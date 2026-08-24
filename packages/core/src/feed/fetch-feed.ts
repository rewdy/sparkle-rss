import { AppError } from '../services/errors';

const USER_AGENT = 'sparkle-rss/0.1 (+https://app.sparklerss.com)';
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchFeedOptions {
  etag?: string | null;
  lastModified?: string | null;
  fetchImpl?: FetchLike;
}

export interface FetchFeedResult {
  status: 'ok' | 'not-modified';
  body?: string;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
  /** Set when every hop was a permanent redirect (301/308) worth persisting. */
  permanentRedirectTo?: string;
}

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT, ...(init?.headers ?? {}) },
    redirect: 'manual',
  });
}

/**
 * Conditional GET with a manual redirect loop so permanent hops (301/308) can be
 * persisted back onto the feed row. Throws AppError(502/504) shaped errors on
 * transport problems so callers can record clean last_error values.
 */
export async function fetchFeed(
  url: string,
  options: FetchFeedOptions = {},
): Promise<FetchFeedResult> {
  const doFetch = options.fetchImpl ?? defaultFetch;
  let current = url;
  let allPermanent = true;

  const headers: Record<string, string> = {
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  };
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await doFetch(current, { headers });
    } catch (error) {
      throw new AppError(504, `fetch failed for ${current}: ${(error as Error).message}`);
    }

    if (response.status === 304) {
      return {
        status: 'not-modified',
        etag: options.etag ?? null,
        lastModified: options.lastModified ?? null,
        finalUrl: current,
      };
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new AppError(502, `redirect without location at ${current}`);
      if (![301, 308].includes(response.status)) allPermanent = false;
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      throw new AppError(502, `${current} responded ${response.status}`);
    }

    const body = await response.text();
    const result: FetchFeedResult = {
      status: 'ok',
      body,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      finalUrl: current,
    };
    if (allPermanent && current !== url && hop > 0) {
      result.permanentRedirectTo = current;
    }
    return result;
  }

  throw new AppError(508, `too many redirects starting at ${url}`);
}
