import { lookup } from "node:dns/promises";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { FetchLike } from "../feed/discover";
import { sanitizeEntryHtml } from "../feed/sanitize";
import { AppError } from "../services/errors";

/**
 * Bounded, best-effort fetch + readable-content extraction for a URL the user
 * chose to save. Everything here is defensive: the input is arbitrary and the
 * result is stored and later rendered.
 */

const USER_AGENT = "sparkle-rss/0.1 (+https://app.sparklerss.com)";
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_CHARS = 500_000;
/** Below this much extracted prose, treat the page as unreadable. */
const MIN_BODY_CHARS = 250;

export type ResolveHost = (hostname: string) => Promise<string[]>;

/** linkedom's document type; the DOM lib is intentionally not in scope here. */
type ParsedDocument = ReturnType<typeof parseHTML>["document"];
type ReadabilityDocument = ConstructorParameters<typeof Readability>[0];

export interface ExtractedArticle {
  /** Final URL after redirects. */
  url: string;
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  contentHtml: string;
  imageUrl: string;
  publishedAt: Date | null;
  /** True when a readable article body was found (contentHtml may be empty). */
  extracted: boolean;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p)))
    return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0] ?? "";
  if (addr === "::" || addr === "::1") return true;
  // IPv4-mapped/embedded addresses (::ffff:10.0.0.1)
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (embedded?.[1]) return isBlockedIpv4(embedded[1]);
  if (addr.startsWith("fe8") || addr.startsWith("fe9")) return true;
  if (addr.startsWith("fea") || addr.startsWith("feb")) return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true;
  if (addr.startsWith("ff")) return true;
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

const defaultResolve: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Rejects URLs that could reach the deployment's own network: anything that is
 * not http(s), and any host that resolves to a private, loopback, link-local,
 * or metadata address. Applied to every redirect hop, not just the first.
 */
export async function assertPubliclyFetchable(
  rawUrl: string,
  resolve: ResolveHost = defaultResolve,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, "invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(400, "unsupported url scheme");
  }
  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new AppError(400, "could not resolve that address");
  }
  if (addresses.length === 0) {
    throw new AppError(400, "could not resolve that address");
  }
  if (addresses.some(isBlockedAddress)) {
    throw new AppError(400, "that address is not reachable from here");
  }
  return url;
}

async function readBounded(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return text.slice(0, MAX_CONTENT_CHARS);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

async function fetchWithRedirects(
  url: URL,
  fetchImpl: FetchLike,
  resolve: ResolveHost,
): Promise<{ html: string; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new AppError(502, "redirect without a location");
      // Re-validate every hop: a public host may redirect to a private one.
      current = await assertPubliclyFetchable(
        new URL(location, current).toString(),
        resolve,
      );
      continue;
    }
    if (!response.ok) {
      throw new AppError(502, `the site answered ${response.status}`);
    }
    return { html: await readBounded(response), finalUrl: current.toString() };
  }
  throw new AppError(508, "too many redirects");
}

function absolute(value: string | null, base: string): string {
  if (!value) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function metaContent(doc: ParsedDocument, selectors: string[]): string {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute("content");
    if (value?.trim()) return value.trim();
  }
  return "";
}

/** Reads the OG/meta layer, which survives pages Readability gives up on. */
function metaFallback(doc: ParsedDocument, url: string) {
  const title =
    metaContent(doc, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ||
    doc.querySelector("title")?.textContent?.trim() ||
    "";
  const description = metaContent(doc, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
  ]);
  const siteName = metaContent(doc, ['meta[property="og:site_name"]']);
  const author = metaContent(doc, [
    'meta[name="author"]',
    'meta[property="article:author"]',
  ]);
  const image = metaContent(doc, [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]);
  const published = metaContent(doc, [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
  ]);
  const parsedPublished = published ? new Date(published) : null;
  return {
    title,
    description,
    siteName,
    author,
    imageUrl: absolute(image || null, url),
    publishedAt:
      parsedPublished && !Number.isNaN(parsedPublished.getTime())
        ? parsedPublished
        : null,
  };
}

/**
 * Extracts a readable copy of an article. Never throws for content problems:
 * a page without a readable body still yields its metadata.
 */
export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const fallback = metaFallback(document, url);

  let readable: ReturnType<Readability["parse"]> = null;
  try {
    readable = new Readability(document as unknown as ReadabilityDocument, {
      charThreshold: 250,
    }).parse();
  } catch {
    readable = null;
  }

  const rawContent = readable?.content ?? "";
  // Readability can return a stub for a page with almost no prose (a nav bar,
  // a cookie notice). Only accept a body with enough text to be worth reading;
  // otherwise the item degrades to title-plus-link.
  const bodyChars = rawContent
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim().length;
  const hasBody = bodyChars >= MIN_BODY_CHARS;
  const contentHtml = hasBody
    ? sanitizeEntryHtml(rawContent).slice(0, MAX_CONTENT_CHARS)
    : "";
  const title = (readable?.title || fallback.title).trim();
  const siteName =
    readable?.siteName || fallback.siteName || new URL(url).hostname;
  const excerpt = (fallback.description || readable?.excerpt || "").trim();

  return {
    url,
    title: title || new URL(url).hostname,
    byline: (readable?.byline || fallback.author).trim(),
    siteName,
    excerpt: excerpt.slice(0, 1000),
    contentHtml,
    imageUrl: fallback.imageUrl,
    publishedAt: readable?.publishedTime
      ? (() => {
          const parsed = new Date(readable.publishedTime);
          return Number.isNaN(parsed.getTime()) ? fallback.publishedAt : parsed;
        })()
      : fallback.publishedAt,
    extracted: hasBody,
  };
}

/** Fetches a user-supplied URL and returns its readable form. */
export async function fetchAndExtractArticle(
  rawUrl: string,
  deps: { fetchImpl?: FetchLike; resolve?: ResolveHost } = {},
): Promise<ExtractedArticle> {
  const url = await assertPubliclyFetchable(
    rawUrl,
    deps.resolve ?? defaultResolve,
  );
  const { html, finalUrl } = await fetchWithRedirects(
    url,
    deps.fetchImpl ?? fetch,
    deps.resolve ?? defaultResolve,
  );
  return extractArticle(html, finalUrl);
}
