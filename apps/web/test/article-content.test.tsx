// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { useArticleContent } from "../src/lib/article-content";
import type { ContentProjection, Entry } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: { articleContent: { fetch: vi.fn() }, entries: { get: vi.fn() } },
}));
const idle = {
  automaticFetchEligible: true,
  status: "idle" as const,
  fetchedAtMs: null,
  finalUrl: null,
  retryAtMs: null,
  automaticRetryAtMs: null,
  pendingUntilMs: null,
  error: null,
};
const entry: Entry = {
  id: "1",
  feedId: "1",
  title: "Title",
  url: "https://example.com/article",
  author: "",
  contentHtml: "feed",
  originalContentHtml: "feed",
  fullContent: idle,
  publishedAtMs: 0,
  crawledAtMs: 0,
  enclosures: [],
  isRead: false,
  isStarred: false,
  isReadLater: false,
  articleImage: null,
};
const ready: ContentProjection = {
  contentHtml: "full",
  originalContentHtml: "feed",
  fullContent: {
    ...idle,
    status: "ready",
    fetchedAtMs: 1,
    finalUrl: entry.url,
  },
};
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  </StrictMode>
);
afterEach(cleanup);
beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.resetAllMocks();
  vi.mocked(api.articleContent.fetch).mockResolvedValue({
    status: 200,
    retryAfter: null,
    content: ready,
  });
});
describe("article content lifecycle", () => {
  it("automatically fetches once in StrictMode and reuses success on remount", async () => {
    const first = renderHook(() => useArticleContent(entry), { wrapper });
    await waitFor(() =>
      expect(first.result.current.content?.fullContent.status).toBe("ready"),
    );
    expect(api.articleContent.fetch).toHaveBeenCalledTimes(1);
    first.unmount();
    renderHook(() => useArticleContent(entry), { wrapper });
    expect(api.articleContent.fetch).toHaveBeenCalledTimes(1);
  });
  it("uses the entry identity for Read Later and excludes off-feed URLs", async () => {
    const view = renderHook(({ item }) => useArticleContent(item), {
      wrapper,
      initialProps: {
        item: {
          ...entry,
          id: "uuid",
          source: "entry" as const,
          entryId: "1",
        } as Entry,
      },
    });
    await waitFor(() =>
      expect(api.articleContent.fetch).toHaveBeenCalledWith("1", "automatic"),
    );
    view.rerender({
      item: { ...entry, id: "url-uuid", source: "url", entryId: null },
    });
    expect(view.result.current.eligible).toBe(false);
    expect(api.articleContent.fetch).toHaveBeenCalledTimes(1);
  });
  it("honors automatic cooldown while allowing explicit retry after the manual cooldown", async () => {
    const failed: Entry = {
      ...entry,
      fullContent: {
        ...idle,
        status: "error",
        error: "retry",
        retryAtMs: Date.now() - 1,
        automaticRetryAtMs: Date.now() + 900_000,
      },
    };
    const view = renderHook(() => useArticleContent(failed), { wrapper });
    expect(api.articleContent.fetch).not.toHaveBeenCalled();
    act(() => {
      view.result.current.fetch();
    });
    await waitFor(() =>
      expect(api.articleContent.fetch).toHaveBeenCalledWith("1", "manual"),
    );
  });
  it("late completion patches its own caches without clobbering flags or the current reader", async () => {
    let finish!: (value: {
      status: number;
      retryAfter: null;
      content: ContentProjection;
    }) => void;
    vi.mocked(api.articleContent.fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    qc.setQueryData(["entries", "all"], {
      pages: [
        {
          items: [{ ...entry, isRead: true, isStarred: true }],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    qc.setQueryData(["saved", {}], {
      pages: [
        {
          items: [
            {
              kind: "article",
              id: "1",
              savedAtMs: 0,
              entry: { ...entry, isStarred: true },
            },
          ],
          nextCursor: null,
        },
      ],
    });
    const view = renderHook(({ item }) => useArticleContent(item), {
      wrapper,
      initialProps: { item: entry },
    });
    await waitFor(() => expect(api.articleContent.fetch).toHaveBeenCalled());
    view.rerender({
      item: {
        ...entry,
        id: "2",
        fullContent: { ...idle, status: "ready" },
        contentHtml: "second",
      },
    });
    await act(async () =>
      finish({ status: 200, retryAfter: null, content: ready }),
    );
    await waitFor(() =>
      expect(
        qc.getQueryData<{ pages: Array<{ items: Entry[] }> }>([
          "entries",
          "all",
        ])?.pages[0]?.items[0],
      ).toMatchObject({ contentHtml: "full", isRead: true, isStarred: true }),
    );
    expect(view.result.current.content?.contentHtml).toBe("second");
  });
  it("does not fetch invalid URLs or successful entries", () => {
    const view = renderHook(({ item }) => useArticleContent(item), {
      wrapper,
      initialProps: { item: { ...entry, url: "" } },
    });
    expect(view.result.current.eligible).toBe(false);
    view.rerender({ item: { ...entry, ...ready } });
    expect(api.articleContent.fetch).not.toHaveBeenCalled();
  });
});

it("shows server rate-limit feedback without reporting extraction success", async () => {
  vi.mocked(api.articleContent.fetch).mockResolvedValue({
    status: 429,
    retryAfter: 60,
    message: "Please wait before fetching full content again.",
    content: {
      contentHtml: "feed",
      originalContentHtml: "feed",
      fullContent: idle,
    },
  });
  const view = renderHook(() => useArticleContent(entry), { wrapper });
  await waitFor(() =>
    expect(view.result.current.error).toContain("Please wait"),
  );
  expect(view.result.current.content?.fullContent.status).toBe("idle");
  expect(api.articleContent.fetch).toHaveBeenCalledTimes(1);
});

it("offers no automatic or manual reader fetching for long feed bodies", async () => {
  const item = {
    ...entry,
    contentHtml: "Long feed body",
    originalContentHtml: "Long feed body",
    fullContent: { ...idle, automaticFetchEligible: false },
  };
  const view = renderHook(() => useArticleContent(item), { wrapper });
  expect(view.result.current.eligible).toBe(false);
  expect(api.articleContent.fetch).not.toHaveBeenCalled();
  act(() => {
    view.result.current.fetch();
  });
  expect(api.articleContent.fetch).not.toHaveBeenCalled();
});
