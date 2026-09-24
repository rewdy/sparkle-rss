import { describe, expect, it } from "vitest";
import {
  assertPubliclyFetchable,
  extractArticle,
  fetchAndExtractArticle,
  isBlockedAddress,
} from "../src/index";

const publicResolve = async () => ["93.184.216.34"];
const privateResolve = async () => ["10.1.2.3"];

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const ARTICLE = `<!doctype html><html><head>
  <title>Fallback Title</title>
  <meta property="og:title" content="Edge Postgres" />
  <meta property="og:site_name" content="Example Blog" />
  <meta property="og:description" content="A short summary of the post." />
  <meta property="og:image" content="/hero.png" />
  <meta property="article:published_time" content="2026-08-01T10:00:00Z" />
  <meta name="author" content="Ada Lovelace" />
  <script>window.__tracking = true;</script>
  </head><body>
  <article>
    <h1>Edge Postgres</h1>
    <p>${"A reasonably long paragraph about databases at the edge. ".repeat(8)}</p>
    <p><img src="chart.png" onerror="alert(1)" alt="chart"></p>
    <p><a href="javascript:alert(1)">click</a></p>
    <p>${"Second paragraph with enough words to pass the char threshold. ".repeat(8)}</p>
  </article>
  </body></html>`;

describe("ssrf guard", () => {
  it("blocks private, loopback, link-local, and metadata addresses", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "198.18.0.1",
      "239.1.1.1",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "fc00::1",
      "ff02::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of [
      "93.184.216.34",
      "8.8.8.8",
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("rejects non-http schemes and unresolvable hosts", async () => {
    for (const bad of [
      "file:///etc/passwd",
      "ftp://example.com/a",
      "gopher://example.com",
      "not a url",
    ]) {
      await expect(
        assertPubliclyFetchable(bad, publicResolve),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      assertPubliclyFetchable("https://nope.invalid/a", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a host that resolves into the private range", async () => {
    await expect(
      assertPubliclyFetchable("https://internal.example/a", privateResolve),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("fetchAndExtractArticle", () => {
  it("extracts title, metadata, and sanitized body content", async () => {
    const article = await fetchAndExtractArticle("https://example.com/post", {
      fetchImpl: async () => htmlResponse(ARTICLE),
      resolve: publicResolve,
    });
    expect(article).toMatchObject({
      url: "https://example.com/post",
      title: "Edge Postgres",
      siteName: "Example Blog",
      excerpt: "A short summary of the post.",
      imageUrl: "https://example.com/hero.png",
      byline: "Ada Lovelace",
      extracted: true,
    });
    expect(article.publishedAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    // body survived, scripts and event handlers did not
    expect(article.contentHtml).toContain("databases at the edge");
    expect(article.contentHtml).not.toContain("<script");
    expect(article.contentHtml).not.toContain("onerror");
    expect(article.contentHtml).not.toContain("javascript:");
  });

  it("falls back to metadata when there is no readable body", async () => {
    const article = await fetchAndExtractArticle("https://example.com/bare", {
      fetchImpl: async () =>
        htmlResponse(
          `<html><head><meta property="og:title" content="Just a link" /><meta name="description" content="Nothing to read." /></head><body><nav>menu</nav></body></html>`,
        ),
      resolve: publicResolve,
    });
    expect(article).toMatchObject({
      title: "Just a link",
      excerpt: "Nothing to read.",
      contentHtml: "",
      extracted: false,
      siteName: "example.com",
    });
  });

  it("follows redirects and reports the final url", async () => {
    const seen: string[] = [];
    const article = await fetchAndExtractArticle("http://example.com/old", {
      fetchImpl: async (url) => {
        seen.push(String(url));
        if (seen.length === 1) {
          return new Response(null, {
            status: 301,
            headers: { location: "https://example.com/new" },
          });
        }
        return htmlResponse(ARTICLE);
      },
      resolve: publicResolve,
    });
    expect(seen).toEqual(["http://example.com/old", "https://example.com/new"]);
    expect(article.url).toBe("https://example.com/new");
  });

  it("re-validates each redirect hop and refuses private targets", async () => {
    await expect(
      fetchAndExtractArticle("https://example.com/redirect", {
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          }),
        resolve: async (hostname) =>
          hostname === "example.com" ? ["93.184.216.34"] : ["169.254.169.254"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fails loudly on error responses and redirect loops", async () => {
    await expect(
      fetchAndExtractArticle("https://example.com/500", {
        fetchImpl: async () => htmlResponse("boom", 500),
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      fetchAndExtractArticle("https://example.com/loop", {
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/loop" },
          }),
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({ status: 508 });
  });

  it("caps the number of bytes it reads", async () => {
    const huge = `<html><head><title>Big</title></head><body><article><p>${"x".repeat(
      3 * 1024 * 1024,
    )}</p></article></body></html>`;
    const article = await fetchAndExtractArticle("https://example.com/big", {
      fetchImpl: async () => htmlResponse(huge),
      resolve: publicResolve,
    });
    // The read stops at the cap instead of buffering the whole document.
    expect(article.contentHtml.length).toBeLessThan(500_001);
  });
});

describe("extractArticle", () => {
  it("resolves relative og:image values and falls back to the hostname", () => {
    const article = extractArticle(
      `<html><head><meta property="og:image" content="img/a.png" /></head><body><p>hi</p></body></html>`,
      "https://example.com/posts/one",
    );
    expect(article.imageUrl).toBe("https://example.com/posts/img/a.png");
    expect(article.title).toBe("example.com");
  });
});
