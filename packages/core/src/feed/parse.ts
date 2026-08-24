import Parser from 'rss-parser';
import { AppError } from '../services/errors';
import { sanitizeEntryHtml } from './sanitize';

export interface ParsedEntry {
  guid: string;
  title: string;
  contentHtml: string;
  url: string;
  author: string;
  publishedAt: Date;
  enclosures: Array<{ href: string; type?: string; length?: number }>;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string;
  entries: ParsedEntry[];
}

const parser = new Parser({
  customFields: {
    item: ['content:encoded', ['enclosure', { keepArray: false }]] as never,
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
  'content:encoded'?: string;
  creator?: string;
  /** Atom <author><name> nests; normalized below. */
  author?: { name?: string } | string;
  isoDate?: string;
  pubDate?: string;
  enclosure?: { url?: string; type?: string; length?: string | number };
}

export async function parseFeed(xml: string, fallbackSiteUrl = ''): Promise<ParsedFeed> {
  let parsed: { title?: string; link?: string; items?: RawItem[] };
  try {
    parsed = await parser.parseString(xml);
  } catch (error) {
    throw new AppError(422, `unparseable feed XML: ${(error as Error).message}`);
  }

  const feedTitle = (parsed.title ?? '').trim();
  const siteUrl = (parsed.link ?? fallbackSiteUrl).trim();

  const entries: ParsedEntry[] = (parsed.items ?? []).map((item, index) => {
    const link = (item.link ?? '').trim();
    const rawContent = item['content:encoded'] ?? item.content ?? item.summary ?? '';
    const dateSource = item.isoDate ?? item.pubDate;
    const candidate = dateSource ? new Date(dateSource) : new Date();
    const publishedAt = Number.isNaN(candidate.getTime()) ? new Date() : candidate;

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
      guid: (item.guid ?? link ?? `${item.title ?? ''}#${index}`).trim(),
      title: (item.title ?? '').trim() || '(untitled)',
      contentHtml: sanitizeEntryHtml(String(rawContent)),
      url: link,
      author: (typeof item.author === 'object'
        ? (item.author.name ?? '')
        : (item.creator ?? item.author ?? '')
      ).trim(),
      publishedAt,
      enclosures,
    };
  });

  return { title: feedTitle, siteUrl, entries };
}
