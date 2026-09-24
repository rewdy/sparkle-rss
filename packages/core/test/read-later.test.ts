import { describe, expect, it } from "vitest";
import {
  entryDedupeHash,
  normalizeArticleUrl,
  urlDedupeHash,
} from "../src/index";

describe("read later url normalization", () => {
  it("lowercases the host, drops the fragment, and strips tracking params", () => {
    expect(
      normalizeArticleUrl(
        "https://Example.COM/Post?utm_source=news&utm_medium=email&b=2&a=1#comments",
      ),
    ).toBe("https://example.com/Post?a=1&b=2");
  });

  it("keeps meaningful query params and their order-independence", () => {
    expect(normalizeArticleUrl("http://example.com/search?q=rss&page=2")).toBe(
      normalizeArticleUrl("http://example.com/search?page=2&q=rss"),
    );
    expect(normalizeArticleUrl("https://example.com/a?id=7")).toBe(
      "https://example.com/a?id=7",
    );
  });

  it("normalizes an empty path to a slash and preserves the trailing slash", () => {
    expect(normalizeArticleUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(normalizeArticleUrl("https://example.com/a/")).toBe(
      "https://example.com/a/",
    );
  });

  it("rejects non-http schemes and unparseable input", () => {
    for (const bad of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://example.com/x",
      "not a url",
      "",
    ]) {
      expect(() => normalizeArticleUrl(bad)).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
    }
  });
});

describe("read later dedupe hashes", () => {
  it("is stable and separates entries from urls", () => {
    expect(entryDedupeHash(42)).toBe(entryDedupeHash(42));
    expect(urlDedupeHash("https://example.com/a")).toBe(
      urlDedupeHash("https://example.com/a"),
    );
    expect(entryDedupeHash(42)).not.toBe(
      urlDedupeHash("https://example.com/a"),
    );
  });

  it("collapses urls that only differ by tracking noise", () => {
    const a = normalizeArticleUrl("https://example.com/post?utm_campaign=x");
    const b = normalizeArticleUrl("https://example.com/post");
    expect(urlDedupeHash(a)).toBe(urlDedupeHash(b));
    expect(
      urlDedupeHash(normalizeArticleUrl("https://example.com/other")),
    ).not.toBe(urlDedupeHash(b));
  });
});
