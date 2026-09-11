// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntryList } from "../src/components/EntryList";
import type { Entry } from "../src/lib/types";

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
    measureElement: () => {},
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

function Harness(): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <EntryList
      entries={[ENTRY]}
      loading={false}
      activeId={null}
      onSelect={vi.fn()}
      scrollRef={scrollRef}
    />
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
});
