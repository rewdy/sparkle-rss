// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_FULL_CONTENT_TEXT_LIMIT,
  shouldAutomaticallyFetchContent,
} from "../../../packages/core/src/article/content-policy";
import {
  isShortBody,
  SHORT_BODY_TEXT_LIMIT,
  validArticleUrl,
} from "../src/lib/short-body";

describe("displayed body classification", () => {
  const fixtures = [
    "",
    ...[499, 500, 501].flatMap((n) => [
      "a".repeat(n),
      "😀".repeat(n),
      `<p>${"a".repeat(n)}</p>`,
    ]),
    `<p>${"a".repeat(498)}</p><p>b</p>`,
    `<p> ${"a".repeat(498)} &nbsp; </p>`,
    `<p>${"a".repeat(498)}&amp;b</p>`,
    `<script>${"x".repeat(1000)}</script><style>x</style><template>${"x".repeat(1000)}</template><noscript>x</noscript><p> short </p>`,
    `<img src="https://example.com/${"a".repeat(1000)}"><p>hello<br>world</p>`,
  ];
  it("uses the same threshold as automatic fetching", () =>
    expect(SHORT_BODY_TEXT_LIMIT).toBe(AUTOMATIC_FULL_CONTENT_TEXT_LIMIT));
  it.each(fixtures)("matches server normalization for %s", (html) => {
    expect(isShortBody(html)).toBe(shouldAutomaticallyFetchContent(html));
  });
  it.each([
    "",
    "broken",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "ftp://example.com",
  ])("rejects unsafe article URL %s", (url) =>
    expect(validArticleUrl(url)).toBe(false),
  );
  it.each(["https://example.com/post?x=1#part", "http://example.com"])(
    "allows publisher URL %s",
    (url) => expect(validArticleUrl(url)).toBe(true),
  );
});
