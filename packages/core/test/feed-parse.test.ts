import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/feed/parse';
import { sanitizeEntryHtml } from '../src/feed/sanitize';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com/</link>
    <item>
      <title>First Post</title>
      <link>https://example.com/1</link>
      <guid isPermaLink="false">urn:item:1</guid>
      <pubDate>Wed, 22 Jul 2026 10:00:00 GMT</pubDate>
      <dc:creator>Ada</dc:creator>
      <description><![CDATA[<p>Hello <strong>world</strong></p><script>alert(1)</script>]]></description>
      <enclosure url="https://example.com/ep.mp3" type="audio/mpeg" length="123"/>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/2</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://atom.example/"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://atom.example/e1"/>
    <id>tag:atom.example,2026:e1</id>
    <updated>2026-07-22T12:00:00Z</updated>
    <author><name>Grace</name></author>
    <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('normalizes RSS items with content, author, enclosures', async () => {
    const feed = await parseFeed(RSS);
    expect(feed.title).toBe('Example Feed');
    expect(feed.siteUrl).toBe('https://example.com/');
    expect(feed.entries).toHaveLength(2);

    const first = feed.entries.at(0);
    if (!first) throw new Error('expected a first entry');
    expect(first.guid).toBe('urn:item:1');
    expect(first.title).toBe('First Post');
    expect(first.author).toBe('Ada');
    expect(first.url).toBe('https://example.com/1');
    expect(first.publishedAt.toISOString()).toBe('2026-07-22T10:00:00.000Z');
    expect(first.contentHtml).toContain('<strong>world</strong>');
    expect(first.contentHtml).not.toContain('script');
    expect(first.enclosures[0]).toMatchObject({ href: 'https://example.com/ep.mp3', length: 123 });

    // missing guid falls back to link; missing date falls back to ~now
    const second = feed.entries.at(1);
    if (!second) throw new Error('expected a second entry');
    expect(second.guid).toBe('https://example.com/2');
  });

  it('parses Atom feeds', async () => {
    const feed = await parseFeed(ATOM);
    expect(feed.title).toBe('Atom Feed');
    const entry = feed.entries.at(0);
    if (!entry) throw new Error('expected an entry');
    // rss-parser may surface the Atom <id> via guid OR fall back to the link;
    // both are stable identifiers for dedupe purposes.
    expect(entry.guid).toMatch(/e1$/u);
    expect(entry.author).toBe('Grace');
    expect(entry.contentHtml).toContain('<p>Atom body</p>');
  });

  it('rejects garbage XML with a 422-shaped error', async () => {
    await expect(parseFeed('this is not xml')).rejects.toMatchObject({ status: 422 });
  });
});

describe('sanitizeEntryHtml', () => {
  it('strips scripts and event handlers', () => {
    const dirty = '<p onclick="steal()">hi<script>x()</script><iframe src="evil"></iframe></p>';
    const clean = sanitizeEntryHtml(dirty);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('iframe');
    expect(clean).toContain('hi');
  });

  it('keeps media and safe links while adding rel', () => {
    const html =
      '<a href="https://x.example/">go</a><img src="https://x.example/i.png" alt="i"><audio src="https://x.example/a.mp3"></audio>';
    const clean = sanitizeEntryHtml(html);
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('<img src="https://x.example/i.png"');
    expect(clean).toContain('<audio src="https://x.example/a.mp3"');
  });

  it('drops javascript: URLs entirely', () => {
    const clean = sanitizeEntryHtml('<a href="javascript:alert(1)">click</a>');
    expect(clean).not.toContain('javascript:');
  });
});
