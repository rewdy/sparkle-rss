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

  it("gathers the page url, title, selection, and popup flag", () => {
    expect(snippet).toContain("url:location.href");
    expect(snippet).toContain("title:document.title");
    expect(snippet).toContain("window.getSelection()");
    expect(snippet).toContain("popup:'1'");
  });

  it("leaves the form for the user to submit", () => {
    expect(snippet).not.toContain("auto:");
  });

  it("follows the origin it was built for", () => {
    expect(buildBookmarklet("http://localhost:5173")).toContain(
      "window.open('http://localhost:5173/read-later/new?'+q",
    );
  });

  it("opens a small window rather than a tab", () => {
    expect(snippet).toContain("'sparkle-read-later','width=530,height=460'");
  });
});

describe("subscribe bookmarklet", () => {
  it("executes with lossless source/title encoding and a separate popup", async () => {
    const { buildSubscribeBookmarklet } = await import(
      "../src/lib/bookmarklet"
    );
    const source = "https://blog.test/post?q=one&next=two#café";
    const title = "A & B's blog";
    const opened: unknown[][] = [];
    const snippet = buildSubscribeBookmarklet("https://sparkle.test");
    new Function(
      "location",
      "document",
      "window",
      snippet.slice("javascript:".length),
    )(
      { href: source, protocol: "https:" },
      { title },
      { open: (...args: unknown[]) => opened.push(args) },
    );
    const url = new URL(String(opened[0]?.[0]));
    expect(url.origin).toBe("https://sparkle.test");
    expect(url.pathname).toBe("/subscribe");
    expect(url.searchParams.get("url")).toBe(source);
    expect(url.searchParams.get("title")).toBe(title);
    expect(url.searchParams.get("popup")).toBe("1");
    expect(opened[0]?.slice(1)).toEqual([
      "sparkle-subscribe",
      "width=530,height=560",
    ]);
    expect(snippet).not.toContain("excerpt");
  });
});
