import { describe, expect, it } from "vitest";
import { buildBookmarklet } from "../src/lib/bookmarklet";

describe("read later bookmarklet", () => {
  const snippet = buildBookmarklet("https://app.sparklerss.com");

  it("is a javascript: url pointing at this deployment's save form", () => {
    expect(snippet.startsWith("javascript:")).toBe(true);
    expect(snippet).toContain(
      "window.open('https://app.sparklerss.com/read-later/new?'+q",
    );
  });

  it("gathers the page url, title, selection, and auto-submit flag", () => {
    expect(snippet).toContain("url:location.href");
    expect(snippet).toContain("title:document.title");
    expect(snippet).toContain("window.getSelection()");
    expect(snippet).toContain("auto:'1'");
  });

  it("follows the origin it was built for", () => {
    expect(buildBookmarklet("http://localhost:5173")).toContain(
      "window.open('http://localhost:5173/read-later/new?'+q",
    );
  });

  it("opens a small window rather than a tab", () => {
    expect(snippet).toContain("'sparkle-read-later','width=460,height=560'");
  });
});
