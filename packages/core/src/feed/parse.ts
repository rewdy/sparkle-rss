import Parser from "rss-parser";
import { AppError } from "../services/errors";
import type { SelectedArticleImage } from "./article-image";
import { sanitizeEntryHtml } from "./sanitize";

export interface ParsedEntry {
  guid: string;
  title: string;
  contentHtml: string;
  /** Unsanitized feed HTML used only for best-effort image discovery. */
  rawContentHtml: string;
  url: string;
  author: string;
  publishedAt: Date;
  enclosures: Array<{ href: string; type?: string; length?: number }>;
  articleImage?: SelectedArticleImage;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string;
  iconUrl: string;
  entries: ParsedEntry[];
}

const parser = new Parser({
  customFields: {
    feed: ["logo", "icon"],
    item: ["content:encoded", ["enclosure", { keepArray: false }]] as never,
  },
});

function toInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

interface RawItem {
  guid?: string;
  link?: string;
  title?: string;
  content?: string;
  summary?: string;
  contentSnippet?: string;
  "content:encoded"?: string;
  creator?: string;
  /** Atom <author><name> nests; normalized below. */
  author?: { name?: string } | string;
  isoDate?: string;
  pubDate?: string;
  enclosure?: { url?: string; type?: string; length?: string | number };
}

interface RawFeed {
  title?: string;
  link?: string;
  /** RSS 2.0 <channel><image> — rss-parser exposes it as an object. */
  image?: { url?: string } | string;
  /** Atom feed-level <logo>/<icon> via customFields. */
  logo?: string;
  icon?: string;
  items?: RawItem[];
}

/**
 * Resolves the feed's declared icon: RSS 2.0 <image><url>, else Atom <logo>,
 * else Atom <icon>, else ''.
 */
function feedIconUrl(parsed: RawFeed): string {
  const rssImage =
    typeof parsed.image === "string" ? parsed.image : (parsed.image?.url ?? "");
  return (
    rssImage.trim() || (parsed.logo ?? "").trim() || (parsed.icon ?? "").trim()
  );
}

/**
 * Best-effort icon extraction for callers where a parse failure is not fatal
 * (e.g. subscribe-time discovery): returns '' instead of throwing.
 */
export async function extractFeedIconUrl(xml: string): Promise<string> {
  try {
    return feedIconUrl(await parser.parseString(xml));
  } catch {
    return "";
  }
}

export async function parseFeed(
  xml: string,
  fallbackSiteUrl = "",
): Promise<ParsedFeed> {
  let parsed: RawFeed;
  try {
    parsed = await parser.parseString(xml);
  } catch (error) {
    throw new AppError(
      422,
      `unparseable feed XML: ${(error as Error).message}`,
    );
  }

  const feedTitle = (parsed.title ?? "").trim();
  const siteUrl = (parsed.link ?? fallbackSiteUrl).trim();

  const entries: ParsedEntry[] = (parsed.items ?? []).map((item, index) => {
    const link = (item.link ?? "").trim();
    const rawContent =
      item["content:encoded"] ?? item.content ?? item.summary ?? "";
    const dateSource = item.isoDate ?? item.pubDate;
    const candidate = dateSource ? new Date(dateSource) : new Date();
    const publishedAt = Number.isNaN(candidate.getTime())
      ? new Date()
      : candidate;

    const enclosures = item.enclosure?.url
      ? [
          {
            href: String(item.enclosure.url),
            type: item.enclosure.type,
            length: toInt(item.enclosure.length),
          },
        ]
      : [];

    return {
      guid: (item.guid ?? link ?? `${item.title ?? ""}#${index}`).trim(),
      title: (item.title ?? "").trim() || "(untitled)",
      contentHtml: sanitizeEntryHtml(String(rawContent)),
      rawContentHtml: String(rawContent),
      url: link,
      author: (typeof item.author === "object"
        ? (item.author.name ?? "")
        : (item.creator ?? item.author ?? "")
      ).trim(),
      publishedAt,
      enclosures,
    };
  });

  return { title: feedTitle, siteUrl, iconUrl: feedIconUrl(parsed), entries };
}
