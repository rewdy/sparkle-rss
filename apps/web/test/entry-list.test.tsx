// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntryList, EntryRow } from "../src/components/EntryList";
import type { Entry } from "../src/lib/types";

const measurements = vi.hoisted(() => ({ reset: vi.fn(), row: vi.fn() }));

// jsdom gives the scroll container no size, so the real virtualizer measures
// zero rows. Render every row instead; layout is not what this test covers.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    containerRef: () => {},
    getTotalSize: () => count * 68,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 68,
        size: 68,
      })),
    measure: measurements.reset,
    measureElement: measurements.row,
    scrollToIndex: () => {},
  }),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    subscriptions: {
      list: vi.fn(async () => ({
        subscriptions: [
          {
            feedId: "f1",
            url: "https://example.com/feed",
            siteUrl: "https://example.com",
            iconUrl: "https://example.com/icon.png",
            customTitle: null,
            feedTitle: "Example Feed",
            displayTitle: "Example Feed",
            categoryId: null,
            categoryName: null,
            entryCount: 1,
            newestEntryAtMs: null,
          },
        ],
      })),
    },
  },
}));

const ENTRY: Entry = {
  id: "42",
  feedId: "f1",
  title: "Postgres at the edge",
  url: "https://example.com/post",
  author: "Ada",
  contentHtml: "<p>hello</p>",
  publishedAtMs: Date.UTC(2026, 7, 26, 14, 0),
  crawledAtMs: Date.UTC(2026, 7, 26, 14, 0),
  enclosures: [],
  isRead: false,
  isStarred: false,
  articleImage: null,
};

let client: QueryClient;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

function Harness({
  entry = ENTRY,
  presentation = "list",
}: {
  entry?: Entry;
  presentation?: "list" | "feed";
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef}>
      <EntryList
        presentation={presentation}
        entries={[entry]}
        loading={false}
        activeId={null}
        onSelect={vi.fn()}
        scrollRef={scrollRef}
      />
    </div>
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EntryList", () => {
  it("remeasures mounted rows when presentation changes even without a resize event", () => {
    const { rerender } = render(
      <Providers>
        <Harness />
      </Providers>,
    );
    measurements.reset.mockClear();
    measurements.row.mockClear();
    rerender(
      <Providers>
        <Harness presentation="feed" />
      </Providers>,
    );
    expect(measurements.reset).toHaveBeenCalled();
    const nodes = measurements.row.mock.calls.map(([node]) => node);
    for (const node of document.querySelectorAll("[data-index]"))
      expect(nodes).toContain(node);
  });

  it("shows the feed icon and site before the author", async () => {
    render(
      <Providers>
        <Harness />
      </Providers>,
    );
    expect(await screen.findByText("Example Feed • Ada")).toBeInTheDocument();
    expect(
      document.querySelector('img[src="https://example.com/icon.png"]'),
    ).not.toBeNull();
  });

  it("shows a saved item's note as a blockquote", async () => {
    render(
      <Providers>
        <Harness
          entry={{ ...ENTRY, source: "url", excerpt: "worth a re-read" }}
        />
      </Providers>,
    );
    const note = await screen.findByText("worth a re-read");
    expect(note.closest("blockquote")).not.toBeNull();
  });

  it("renders no blockquote when the item has no note", async () => {
    render(
      <Providers>
        <Harness />
      </Providers>,
    );
    await screen.findByText("Postgres at the edge");
    expect(document.querySelector("blockquote")).toBeNull();
  });
});

const IMAGE = {
  id: "media-1",
  width: 800,
  height: 600,
  alt: "Photo",
  url: "https://example.com/stored.jpg",
  urlExpiresAtMs: Date.now() + 300000,
};

describe("Feed rows", () => {
  it("uses stored imagery only in Feed and retries renewed URLs after failure", async () => {
    const onSelect = vi.fn();
    const row = (url: string, presentation: "list" | "feed" = "feed") => (
      <Providers>
        <EntryRow
          entry={{ ...ENTRY, articleImage: { ...IMAGE, url } }}
          active={false}
          onSelect={onSelect}
          presentation={presentation}
        />
      </Providers>
    );
    const { rerender } = render(row(IMAGE.url));
    const image = document.querySelector(".feed-thumbnail") as HTMLImageElement;
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("width", "96");
    fireEvent.click(image);
    expect(onSelect).toHaveBeenCalledOnce();
    fireEvent.error(image);
    expect(document.querySelector(".feed-thumbnail")).toBeNull();
    expect(screen.getByText(ENTRY.title)).toBeVisible();
    rerender(row("https://example.com/renewed.jpg"));
    expect(document.querySelector(".feed-thumbnail")).toHaveAttribute(
      "src",
      "https://example.com/renewed.jpg",
    );
    rerender(row(IMAGE.url, "list"));
    expect(document.querySelector(".feed-thumbnail")).toBeNull();
  });

  it("keeps image-free notes and never extracts HTML images", async () => {
    render(
      <Providers>
        <EntryRow
          entry={{
            ...ENTRY,
            excerpt: "keep this note",
            contentHtml: '<img src="https://example.com/remote.jpg">',
          }}
          active={false}
          onSelect={vi.fn()}
          presentation="feed"
        />
      </Providers>,
    );
    expect(
      screen.getByText("keep this note").closest("blockquote"),
    ).not.toBeNull();
    expect(document.querySelector(".feed-thumbnail")).toBeNull();
    expect(screen.getByRole("button")).toHaveClass("feed-row");
  });

  it("supports native keyboard activation without a separate thumbnail target", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const onSelect = vi.fn();
    render(
      <Providers>
        <EntryRow
          entry={{ ...ENTRY, articleImage: IMAGE }}
          active={true}
          onSelect={onSelect}
          presentation="feed"
        />
      </Providers>,
    );
    const button = screen.getByRole("button");
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(button).toHaveAttribute("data-active");
    expect(button.querySelectorAll("button,a,[tabindex]")).toHaveLength(0);
  });

  it("shows a Feed skeleton and accessible loading status", () => {
    function Loading() {
      const scrollRef = useRef<HTMLDivElement>(null);
      return (
        <EntryList
          entries={[]}
          loading
          activeId={null}
          onSelect={vi.fn()}
          scrollRef={scrollRef}
          presentation="feed"
        />
      );
    }
    render(
      <Providers>
        <Loading />
      </Providers>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading articles");
    expect(document.querySelectorAll(".feed-thumbnail")).toHaveLength(12);
  });
});
