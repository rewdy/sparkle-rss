import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverFeed, type FetchLike } from "../src/feed/discover";
import { discoverWebFeed } from "../src/feed/discover-web";
import { createSubscriptionsService } from "../src/services/subscriptions";

const xml = '<rss version="2.0"><channel><title>Blog</title></channel></rss>';
const link = (url: string) =>
  `<link rel="alternate" type="application/rss+xml" href="${url}">`;
function fixture(pages: Record<string, string | number>) {
  return vi.fn<FetchLike>(async (url) => {
    const body = pages[url] ?? 404;
    return typeof body === "number"
      ? new Response("missing", { status: body })
      : new Response(body);
  });
}
afterEach(() => vi.useRealTimers());

describe("web feed discovery", () => {
  it("previews without touching a database or refresh hook", async () => {
    const refresh = vi.fn();
    // A discovery-only service needs no database operations at all.
    const service = createSubscriptionsService(
      { db: null as never },
      { onSubscribed: refresh },
    );
    expect(
      await service.discover(
        "https://blog.test/rss",
        fixture({ "https://blog.test/rss": xml }),
      ),
    ).toEqual({
      feedUrl: "https://blog.test/rss",
      siteUrl: "https://blog.test/rss",
      title: "Blog",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("prefers the first valid page feed and never requests the root", async () => {
    const fetcher = fixture({
      "https://blog.test/post": link("/broken") + link("/rss") + link("/other"),
      "https://blog.test/rss": xml,
      "https://blog.test/other": xml,
    });
    expect(
      (await discoverWebFeed("https://blog.test/post", fetcher)).feedUrl,
    ).toBe("https://blog.test/rss");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://blog.test/post",
      "https://blog.test/broken",
      "https://blog.test/rss",
    ]);
  });

  it("falls back to the exact origin after missing feed or upstream failure", async () => {
    for (const page of ["<html>post</html>", 404]) {
      const fetcher = fixture({
        "http://alice.blog.test:8080/post?q=1#comments": page,
        "http://alice.blog.test:8080/": link("/rss"),
        "http://alice.blog.test:8080/rss": xml,
      });
      expect(
        (
          await discoverWebFeed(
            "http://alice.blog.test:8080/post?q=1#comments",
            fetcher,
          )
        ).feedUrl,
      ).toBe("http://alice.blog.test:8080/rss");
      expect(fetcher.mock.calls.map(([url]) => url)).toContain(
        "http://alice.blog.test:8080/",
      );
    }
  });

  it("does not repeat a root or candidate, including a redirected root", async () => {
    const fetcher = fixture({
      "https://blog.test/post": link("/broken"),
      "https://blog.test/": link("/broken") + link("/rss"),
      "https://blog.test/rss": xml,
    });
    await discoverWebFeed("https://blog.test/post", fetcher);
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/broken")),
    ).toHaveLength(1);
    const redirect = vi.fn<FetchLike>(async () => {
      const response = new Response("no feed");
      Object.defineProperty(response, "url", { value: "https://blog.test/" });
      return response;
    });
    await expect(
      discoverWebFeed("https://blog.test/post", redirect),
    ).rejects.toMatchObject({ status: 422 });
    expect(redirect).toHaveBeenCalledTimes(1);
    const root = fixture({ "https://blog.test/": "no feed" });
    await expect(
      discoverWebFeed("https://blog.test/", root),
    ).rejects.toMatchObject({ status: 422 });
    expect(root).toHaveBeenCalledTimes(1);
  });

  it("removes credentials from the fallback and keeps nullable titles", async () => {
    const fetcher = fixture({
      "https://user:pass@blog.test/post": "no feed",
      "https://blog.test/": '<rss version="2.0"><channel/></rss>',
    });
    expect(
      (await discoverWebFeed("https://user:pass@blog.test/post", fetcher))
        .title,
    ).toBeNull();
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://blog.test/");
  });

  it("rejects invalid inputs and non-http output without root fallback", async () => {
    for (const url of ["bad", "file:///tmp/feed"]) {
      const fetcher = fixture({});
      await expect(discoverWebFeed(url, fetcher)).rejects.toMatchObject({
        status: 400,
      });
      expect(fetcher).not.toHaveBeenCalled();
    }
    const fetcher = vi.fn<FetchLike>(async () => {
      const response = new Response(xml);
      Object.defineProperty(response, "url", { value: "file:///tmp/feed" });
      return response;
    });
    await expect(
      discoverWebFeed("https://blog.test/post", fetcher),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps inspected pages to 422 and entirely unreachable sites to 502", async () => {
    await expect(
      discoverWebFeed("https://blog.test/post", fixture({})),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      discoverWebFeed(
        "https://blog.test/post",
        fixture({ "https://blog.test/post": "no feed" }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("caps requests and body reads at ten seconds within one twenty-second deadline", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<FetchLike>(async (_url, init) => {
      signals.push(init?.signal as AbortSignal);
      const response = new Response("unused");
      vi.spyOn(response, "text").mockImplementation(
        () => new Promise(() => {}),
      );
      return response;
    });
    const result = discoverWebFeed("https://blog.test/post", fetcher);
    const rejection = expect(result).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(signals[1]?.aborted).toBe(true);
    expect(Date.now()).toBeGreaterThan(0);
  });

  it("keeps the original discovery default without homepage fallback", async () => {
    const fetcher = fixture({
      "https://blog.test/post": "no feed",
      "https://blog.test/": xml,
    });
    await expect(
      discoverFeed("https://blog.test/post", fetcher),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives the root only the remaining budget after slow page and candidate requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<FetchLike>(async (url, init) => {
      signals.push(init?.signal as AbortSignal);
      if (url.endsWith("/post")) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        return new Response(link("/broken"));
      }
      return new Promise(() => {});
    });
    const result = discoverWebFeed("https://blog.test/post", fetcher);
    const rejection = expect(result).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://blog.test/post",
      "https://blog.test/broken",
      "https://blog.test/",
    ]);
    expect(signals[1]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    await rejection;
    expect(signals[2]?.aborted).toBe(true);
  });
});
