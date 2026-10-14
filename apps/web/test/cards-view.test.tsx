// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArticleCard,
  buildCardRows,
  CardsView,
} from "../src/components/CardsView";
import type { Entry } from "../src/lib/types";

const virtual = vi.hoisted(() => ({ scroll: vi.fn(), limit: 2 }));
vi.mock("@tanstack/react-virtual", () => ({
  defaultRangeExtractor: () => [0, 1],
  useVirtualizer: ({
    count,
    rangeExtractor,
  }: {
    count: number;
    rangeExtractor: (range: object) => number[];
  }) => ({
    containerRef: () => {},
    getTotalSize: () => count * 250,
    getVirtualItems: () =>
      [
        ...new Set([
          ...Array.from(
            { length: Math.min(count, virtual.limit) },
            (_, i) => i,
          ),
          ...rangeExtractor({}),
        ]),
      ]
        .filter((i) => i < count)
        .sort((a, b) => a - b)
        .map((index) => ({ index, start: index * 250, key: index })),
    measure: () => {},
    measureElement: () => {},
    scrollToIndex: virtual.scroll,
  }),
}));
vi.mock("../src/lib/api", () => ({
  api: { subscriptions: { list: async () => ({ subscriptions: [] }) } },
}));
const entry: Entry = {
  id: "1",
  feedId: "",
  title: "A long headline worth reading",
  url: "https://example.test/article",
  author: "Ada",
  siteName: "Example",
  contentHtml: '<img src="https://remote.test/image">',
  publishedAtMs: Date.now(),
  crawledAtMs: Date.now(),
  enclosures: [],
  isRead: false,
  isStarred: false,
  isReadLater: false,
  articleImage: null,
};
const image = {
  id: "media",
  width: 800,
  height: 600,
  alt: "redundant",
  url: "https://stored.test/image",
  urlExpiresAtMs: Date.now() + 300000,
};
function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    </MantineProvider>
  );
}
function Harness({
  entries = [entry],
  activeId = null,
  loading = false,
}: {
  entries?: Entry[];
  activeId?: string | null;
  loading?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef}>
      <CardsView
        entries={entries}
        activeId={activeId}
        loading={loading}
        onSelect={vi.fn()}
        scrollRef={scrollRef}
      />
    </div>
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  virtual.limit = 2;
});

describe("article cards", () => {
  it("shows source, author, full headline, note, read styling and a decorative placeholder", () => {
    render(
      <Providers>
        <ArticleCard
          entry={{ ...entry, isRead: true, excerpt: "My note" }}
          active
          onSelect={vi.fn()}
        />
      </Providers>,
    );
    expect(screen.getByText(entry.title)).toHaveStyle({ fontWeight: "400" });
    expect(screen.getByText("Example • Ada")).toBeInTheDocument();
    expect(screen.getByText("My note").closest("blockquote")).not.toBeNull();
    expect(screen.getByRole("button")).toHaveAttribute("data-active");
    expect(
      document.querySelector(".card-placeholder")?.parentElement,
    ).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("img")).toBeNull();
  });
  it("uses authorized lazy imagery, falls back on failure and retries a renewed URL", () => {
    const select = vi.fn();
    const card = (url: string) => (
      <Providers>
        <ArticleCard
          entry={{ ...entry, articleImage: { ...image, url } }}
          active={false}
          onSelect={select}
        />
      </Providers>
    );
    const { rerender } = render(card(image.url));
    const img = document.querySelector(".card-media img") as HTMLImageElement;
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    fireEvent.click(img);
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
    fireEvent.error(img);
    expect(document.querySelector(".card-placeholder")).not.toBeNull();
    expect(document.querySelector(".card-media img")).toBeNull();
    rerender(card(`${image.url}?renewed`));
    expect(document.querySelector(".card-media img")).toHaveAttribute(
      "src",
      `${image.url}?renewed`,
    );
  });
  it("supports Enter and Space with a single native focus target", async () => {
    const select = vi.fn();
    const user = userEvent.setup();
    render(
      <Providers>
        <ArticleCard entry={entry} active={false} onSelect={select} />
      </Providers>,
    );
    screen.getByRole("button").focus();
    await user.keyboard("{Enter} ");
    expect(select).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button").querySelectorAll("a,button,[tabindex]"),
    ).toHaveLength(0);
  });
});

describe("card grid", () => {
  it.each([1, 2, 3])(
    "preserves groups and ordered entries with %s columns and appends",
    (columns) => {
      const entries = Array.from({ length: 7 }, (_, i) => ({
        ...entry,
        id: String(i),
        publishedAtMs:
          i < 5 ? entry.publishedAtMs : entry.publishedAtMs - 86400000,
      }));
      const rows = buildCardRows(entries, columns);
      expect(
        rows.filter((row) => row.kind === "header").map((row) => row.count),
      ).toEqual([5, 2]);
      expect(
        rows.flatMap((row) =>
          row.kind === "cards" ? row.entries.map((e) => e.id) : [],
        ),
      ).toEqual(entries.map((e) => e.id));
      for (const row of rows)
        if (row.kind === "cards")
          expect(row.entries.length).toBeLessThanOrEqual(columns);
      const appended = buildCardRows(
        [...entries, { ...entries[6], id: "8" } as Entry],
        columns,
      );
      expect(
        appended.filter((row) => row.kind === "header").map((row) => row.count),
      ).toEqual([5, 3]);
    },
  );
  it("mounts only a limited range and moves focus beyond it in both directions", async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      ...entry,
      id: String(i),
      title: `Article ${i}`,
    }));
    render(
      <Providers>
        <Harness entries={entries} />
      </Providers>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const user = userEvent.setup();
    screen.getByRole("button").focus();
    for (let i = 1; i < 12; i++) {
      await user.tab();
      expect(document.activeElement).toHaveAttribute(
        "data-entry-id",
        String(i),
      );
    }
    await user.tab({ shift: true });
    expect(document.activeElement).toHaveAttribute("data-entry-id", "10");
    expect(screen.getAllByRole("button").length).toBeLessThan(30);
    expect(virtual.scroll).toHaveBeenCalled();
  });
  it("scrolls an active deep-linked entry into view", () => {
    render(
      <Providers>
        <Harness entries={[entry, { ...entry, id: "2" }]} activeId="2" />
      </Providers>,
    );
    expect(virtual.scroll).toHaveBeenCalledWith(2, { align: "auto" });
  });
  it("shows one loading status and card skeletons then the empty state", () => {
    const { rerender } = render(
      <Providers>
        <Harness loading />
      </Providers>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelectorAll(".card-media")).toHaveLength(9);
    rerender(
      <Providers>
        <Harness entries={[]} />
      </Providers>,
    );
    expect(screen.getByText("nothing here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
