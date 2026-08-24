import { AppError } from '../services/errors';
import { extractFeedIconUrl } from './parse';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 10_000;
export const USER_AGENT = 'sparkle-rss/0.1 (+https://app.sparklerss.com)';

export interface DiscoveredFeed {
  feedUrl: string;
  siteUrl: string;
  title: string | null;
  iconUrl: string;
}

function extractTitle(xml: string): string | null {
  const match = /<title[^>]*>(?:<!\[CDATA\[)?([^<]+)(?:\]\]>)?<\/title>/i.exec(xml);
  return match?.[1]?.trim() || null;
}

export function looksLikeFeed(body: string): boolean {
  return /<rss[\s>]|<feed[\s\S]*?xmlns|<rdf:rdf[\s>]/i.test(body.slice(0, 4096));
}

function extractAlternateLinks(html: string): string[] {
  const links: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) ?? []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) links.push(href);
  }
  return links;
}

/**
 * Resolves a user-supplied URL to a feed. Accepts direct feed URLs and HTML
 * pages with <link rel="alternate"> autodiscovery. The fetcher is injectable
 * for tests.
 */
export async function discoverFeed(
  inputUrl: string,
  fetchImpl: FetchLike = (u, i) =>
    fetch(u, {
      ...i,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, ...(i?.headers ?? {}) },
      redirect: 'follow',
    }),
): Promise<DiscoveredFeed> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new AppError(400, `not a valid URL: ${inputUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'only http(s) URLs are supported');
  }

  const first = await fetchImpl(parsed.toString()).catch(() => {
    throw new AppError(502, `could not reach ${parsed.hostname}`);
  });
  if (!first.ok) {
    throw new AppError(502, `${parsed.hostname} responded ${first.status}`);
  }
  const body = await first.text();
  const finalUrl = first.url || parsed.toString();

  if (looksLikeFeed(body)) {
    return {
      feedUrl: finalUrl,
      siteUrl: finalUrl,
      title: extractTitle(body),
      iconUrl: await extractFeedIconUrl(body),
    };
  }

  for (const href of extractAlternateLinks(body).slice(0, 3)) {
    let candidate: URL;
    try {
      candidate = new URL(href, finalUrl);
    } catch {
      continue;
    }
    const feedResponse = await fetchImpl(candidate.toString()).catch(() => null);
    if (!feedResponse?.ok) continue;
    const feedBody = await feedResponse.text();
    if (looksLikeFeed(feedBody)) {
      return {
        feedUrl: feedResponse.url || candidate.toString(),
        siteUrl: finalUrl,
        title: extractTitle(feedBody),
        iconUrl: await extractFeedIconUrl(feedBody),
      };
    }
  }

  throw new AppError(422, `no feed found at ${finalUrl}`);
}
