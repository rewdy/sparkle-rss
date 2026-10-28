import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_FULL_CONTENT_TEXT_LIMIT,
  shouldAutomaticallyFetchContent,
} from "../src/article/content-policy";

describe("automatic full-content threshold", () => {
  it.each([
    0,
    AUTOMATIC_FULL_CONTENT_TEXT_LIMIT - 1,
    AUTOMATIC_FULL_CONTENT_TEXT_LIMIT,
    AUTOMATIC_FULL_CONTENT_TEXT_LIMIT + 1,
  ])("measures the strict boundary at %i readable characters", (length) => {
    expect(
      shouldAutomaticallyFetchContent(`<p>${"a".repeat(length)}</p>`),
    ).toBe(length < AUTOMATIC_FULL_CONTENT_TEXT_LIMIT);
  });
  it("ignores markup and image URLs and normalizes entities and whitespace", () => {
    const text = "a".repeat(AUTOMATIC_FULL_CONTENT_TEXT_LIMIT - 2);
    expect(
      shouldAutomaticallyFetchContent(
        `<p>\n ${text} &nbsp; </p><img src="https://example.com/${"x".repeat(1000)}">`,
      ),
    ).toBe(true);
    expect(shouldAutomaticallyFetchContent(`<p>${text}</p><p>b</p>`)).toBe(
      false,
    );
    expect(shouldAutomaticallyFetchContent(`<p>${text}&amp;b</p>`)).toBe(false);
    expect(
      shouldAutomaticallyFetchContent(
        `<script>${"x".repeat(1000)}</script><style>${"x".repeat(1000)}</style>`,
      ),
    ).toBe(true);
  });
  it("counts Unicode characters rather than UTF-16 code units", () => {
    expect(
      shouldAutomaticallyFetchContent(
        "😀".repeat(AUTOMATIC_FULL_CONTENT_TEXT_LIMIT - 1),
      ),
    ).toBe(true);
    expect(
      shouldAutomaticallyFetchContent(
        "😀".repeat(AUTOMATIC_FULL_CONTENT_TEXT_LIMIT),
      ),
    ).toBe(false);
  });
});
