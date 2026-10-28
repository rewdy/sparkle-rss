import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { FetchLike } from "../feed/discover";
import { sanitizeEntryHtml } from "../feed/sanitize";
import { AppError } from "../services/errors";
import {
  beforeDeadline,
  isPublicImageAddress,
  publicRequest,
} from "./public-request";

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
  if (url.username || url.password)
    throw new AppError(400, "URL credentials are not supported");
  let addresses: string[];
  try {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new AppError(400, "could not resolve that address");
  }
  if (addresses.length === 0) {
    throw new AppError(400, "could not resolve that address");
  }
  if (addresses.some((address) => !isPublicImageAddress(address))) {
    throw new AppError(400, "that address is not reachable from here");
  }
  return url;
}

async function readBounded(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new AppError(413, "article exceeds 2 MiB");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await beforeDeadline(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new AppError(413, "article exceeds 2 MiB");
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchWithRedirects(
  rawUrl: string,
  fetchImpl: FetchLike | undefined,
  resolve: ResolveHost,
  cancellation?: AbortSignal,
): Promise<{ html: string; finalUrl: string }> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const signal = cancellation
    ? AbortSignal.any([deadline, cancellation])
    : deadline;
  const request = publicRequest(
    resolve,
    MAX_BYTES,
    "text/html,application/xhtml+xml",
  );
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await beforeDeadline(
      assertPubliclyFetchable(current, resolve),
      signal,
    );
    const response = await beforeDeadline(
      fetchImpl
        ? fetchImpl(url.toString(), {
            redirect: "manual",
            signal,
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "text/html,application/xhtml+xml",
            },
          })
        : request(url, signal),
      signal,
    );
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || hop === MAX_REDIRECTS)
        throw new AppError(508, "too many or invalid redirects");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(502, "the article could not be downloaded");
    }
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (mime !== "text/html" && mime !== "application/xhtml+xml") {
      await response.body?.cancel();
      throw new AppError(422, "the source is not an HTML article");
    }
    return {
      html: await readBounded(response, signal),
      finalUrl: url.toString(),
    };
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
 * Extracts a readable copy of an article. An unreadable page yields metadata;
 * oversized extracted HTML is rejected rather than truncated.
 */
export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const fallback = metaFallback(document, url);
  document
    .querySelectorAll("base")
    .forEach(
      (node: {
        remove(): void;
        getAttribute(name: string): string | null;
        setAttribute(name: string, value: string): void;
      }) => {
        node.remove();
      },
    );
  document
    .querySelectorAll("[href], [src]")
    .forEach(
      (node: {
        remove(): void;
        getAttribute(name: string): string | null;
        setAttribute(name: string, value: string): void;
      }) => {
        for (const attr of ["href", "src"]) {
          const value = node.getAttribute(attr);
          if (value) node.setAttribute(attr, absolute(value, url));
        }
      },
    );

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
  const contentHtml = hasBody ? sanitizeEntryHtml(rawContent) : "";
  if (contentHtml.length > MAX_CONTENT_CHARS)
    throw new AppError(413, "extracted article is too large");
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
    extracted:
      hasBody && contentHtml.replace(/<[^>]*>/gu, " ").trim().length > 0,
  };
}

/** Fetches a user-supplied URL and returns its readable form. */
export async function fetchAndExtractArticle(
  rawUrl: string,
  deps: {
    fetchImpl?: FetchLike;
    resolve?: ResolveHost;
    signal?: AbortSignal;
  } = {},
): Promise<ExtractedArticle> {
  try {
    const { html, finalUrl } = await fetchWithRedirects(
      rawUrl,
      deps.fetchImpl,
      deps.resolve ?? defaultResolve,
      deps.signal,
    );
    return extractArticle(html, finalUrl);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "article could not be fetched; please retry");
  }
}
