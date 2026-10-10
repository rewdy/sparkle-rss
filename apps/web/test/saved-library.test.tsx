// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedImagePane } from "../src/components/SavedImagePane";
import { SavedList, SavedRows } from "../src/components/SavedList";
import type { Entry, SavedImage } from "../src/lib/types";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    containerRef: () => {},
    getTotalSize: () => count * 160,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 160,
      })),
    measureElement: () => {},
  }),
}));
vi.mock("../src/lib/api", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: {
    saved: { list: vi.fn() },
    savedImages: { get: vi.fn(), remove: vi.fn() },
    subscriptions: { list: vi.fn(async () => ({ subscriptions: [] })) },
  },
}));

import { ApiError, api } from "../src/lib/api";

const savedAtMs = Date.now();
const image: SavedImage = {
  id: "12345678-1234-1234-1234-123456789012",
  savedAtMs,
  imageSourceUrl: "https://example.com/image.png",
  image: {
    id: "media",
    width: 300,
    height: 200,
    alt: "A diagram",
    url: "https://s3.example/stored",
    urlExpiresAtMs: Date.now() + 300_000,
  },
  source: {
    kind: "entry",
    id: "42",
    articleTitle: "Image article",
    articleUrl: "https://example.com/article",
    feedId: "1",
    feedTitle: "Feed",
    feedUrl: "https://example.com/feed",
    siteName: "",
    available: true,
  },
};
const entry: Entry = {
  id: "42",
  feedId: "1",
  title: "Saved article",
  url: "https://example.com/article",
  contentHtml: "<p>article body</p>",
  author: "",
  publishedAtMs: 0,
  crawledAtMs: 0,
  enclosures: [],
  isRead: true,
  isStarred: true,
  isReadLater: false,
  articleImage: null,
};
let client: QueryClient;
function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
  vi.mocked(api.subscriptions.list).mockResolvedValue({ subscriptions: [] });
  vi.mocked(api.savedImages.get).mockResolvedValue({ item: image });
  vi.mocked(api.savedImages.remove).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe("mixed Saved rows", () => {
  it("groups both item types by save time and preserves article payload on selection", async () => {
    const onArticle = vi.fn(),
      onImage = vi.fn();
    function Rows() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref}>
          <SavedRows
            items={[
              { kind: "image", id: image.id, savedAtMs, item: image },
              { kind: "article", id: entry.id, savedAtMs, entry },
            ]}
            scrollRef={ref}
            onSelectArticle={onArticle}
            onSelectImage={onImage}
          />
        </div>
      );
    }
    render(
      <Providers>
        <Rows />
      </Providers>,
    );
    expect(screen.getAllByText("today")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "A diagram" })).toHaveAttribute(
      "src",
      image.image.url,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "view saved image: Image article" }),
    );
    expect(onImage).toHaveBeenCalledWith(image.id);
    await userEvent.click(screen.getByText("Saved article"));
    expect(onArticle).toHaveBeenCalledWith(entry);
    expect(screen.queryByText("article body")).not.toBeInTheDocument();
  });
  it("renders the empty state", async () => {
    vi.mocked(api.saved.list).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    render(
      <Providers>
        <SavedList
          sort="asc"
          hidden={false}
          onSelectArticle={vi.fn()}
          onSelectImage={vi.fn()}
        />
      </Providers>,
    );
    expect(await screen.findByText("nothing saved yet.")).toBeInTheDocument();
    expect(api.saved.list).toHaveBeenCalledWith({
      sort: "asc",
      limit: 50,
      cursor: undefined,
    });
  });
  it("keeps the list mounted when a reader opens", async () => {
    vi.mocked(api.saved.list).mockResolvedValue({
      items: [{ kind: "image", id: image.id, savedAtMs, item: image }],
      nextCursor: null,
    });
    const props = {
      sort: "desc" as const,
      onSelectArticle: vi.fn(),
      onSelectImage: vi.fn(),
    };
    const view = render(
      <Providers>
        <SavedList {...props} hidden={false} />
      </Providers>,
    );
    await screen.findByRole("button", {
      name: "view saved image: Image article",
    });
    const container = document.querySelector("[data-stream-scroll]");
    if (!(container instanceof HTMLElement))
      throw new Error("missing scroll container");
    container.scrollTop = 400;
    view.rerender(
      <Providers>
        <SavedList {...props} hidden />
      </Providers>,
    );
    view.rerender(
      <Providers>
        <SavedList {...props} hidden={false} />
      </Providers>,
    );
    expect(document.querySelector("[data-stream-scroll]")).toBe(container);
    expect(container.scrollTop).toBe(400);
  });
});

describe("saved image preview", () => {
  it("loads an independent deep link with snapshot attribution and source links", async () => {
    render(
      <Providers>
        <SavedImagePane
          id={image.id}
          sort="asc"
          onClose={vi.fn()}
          onRemoved={vi.fn()}
        />
      </Providers>,
    );
    expect(
      await screen.findByRole("heading", { name: "Image article" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "read article" })).toHaveAttribute(
      "href",
      "/starred/e/42?sort=asc",
    );
    expect(
      screen.getByRole("link", { name: "open original article" }),
    ).toHaveAttribute("href", image.source.articleUrl);
    expect(api.savedImages.get).toHaveBeenCalledWith(image.id);
  });
  it("retains source details when the source is missing", async () => {
    vi.mocked(api.savedImages.get).mockResolvedValue({
      item: { ...image, source: { ...image.source, available: false } },
    });
    render(
      <Providers>
        <SavedImagePane
          id={image.id}
          sort="desc"
          onClose={vi.fn()}
          onRemoved={vi.fn()}
        />
      </Providers>,
    );
    await screen.findByRole("img", { name: "A diagram" });
    expect(
      screen.queryByRole("link", { name: "read article" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "open original article" }),
    ).toBeInTheDocument();
  });
  it("removes independently and returns to the list only on success", async () => {
    const onRemoved = vi.fn();
    render(
      <Providers>
        <SavedImagePane
          id={image.id}
          sort="desc"
          onClose={vi.fn()}
          onRemoved={onRemoved}
        />
      </Providers>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "remove saved image" }),
    );
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(api.savedImages.remove).toHaveBeenCalledWith(image.id);
  });
  it("shows deletion failure without navigating", async () => {
    vi.mocked(api.savedImages.remove).mockRejectedValue(new Error("offline"));
    const onRemoved = vi.fn();
    render(
      <Providers>
        <SavedImagePane
          id={image.id}
          sort="desc"
          onClose={vi.fn()}
          onRemoved={onRemoved}
        />
      </Providers>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "remove saved image" }),
    );
    expect(
      await screen.findByText("Could not remove image. Try again."),
    ).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });
  it("handles deleted image deep links", async () => {
    vi.mocked(api.savedImages.get).mockRejectedValue(
      new ApiError(404, "missing"),
    );
    render(
      <Providers>
        <SavedImagePane
          id={image.id}
          sort="desc"
          onClose={vi.fn()}
          onRemoved={vi.fn()}
        />
      </Providers>,
    );
    expect(
      await screen.findByText("This saved image is no longer available."),
    ).toBeInTheDocument();
  });
});
