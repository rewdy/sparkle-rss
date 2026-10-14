// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamInner } from "../src/components/StreamInner";
import { Topbar } from "../src/components/Topbar";
import type { Entry, StreamDescriptor } from "../src/lib/types";

const entry: Entry = {
  id: "1",
  feedId: "1",
  title: "Fixture headline",
  url: "",
  author: "",
  contentHtml: "",
  publishedAtMs: Date.now(),
  crawledAtMs: Date.now(),
  enclosures: [],
  isRead: false,
  isStarred: false,
  isReadLater: false,
  articleImage: null,
};
vi.mock("../src/lib/api", () => ({
  api: {
    entries: {
      list: vi.fn(async () => ({ items: [entry], nextCursor: null })),
    },
  },
}));
vi.mock("../src/lib/mutations", () => ({
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../src/components/EntryList", () => ({
  EntryList: ({ onSelect }: { onSelect: (e: Entry) => void }) => (
    <button type="button" onClick={() => onSelect(entry)}>
      Rendered list
    </button>
  ),
}));
vi.mock("../src/components/CardsView", () => ({
  CardsView: ({
    onSelect,
    entries,
    activeId,
    visible,
  }: {
    onSelect: (entry: Entry) => void;
    entries: Entry[];
    activeId: string | null;
    visible: boolean;
  }) => (
    <div data-card-active={activeId} data-card-visible={visible}>
      <button
        type="button"
        onClick={() => {
          if (entries[0]) onSelect(entries[0]);
        }}
      >
        Rendered cards
      </button>
      {entries.map((item) => (
        <span
          key={item.id}
          data-card-id={item.id}
          data-image-url={item.articleImage?.url}
        >
          {item.title}
        </span>
      ))}
    </div>
  ),
}));
vi.mock("../src/components/StoryView", () => ({
  StoryView: () => <div>Rendered swipe</div>,
}));

function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        {children}
      </QueryClientProvider>
    </MantineProvider>
  );
}

import { api } from "../src/lib/api";

beforeEach(() => {
  vi.mocked(api.entries.list)
    .mockReset()
    .mockResolvedValue({ items: [entry], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Presentation integration", () => {
  it.each(["list", "cards", "swipe"] as const)(
    "selects %s through the header",
    (mode) => {
      const change = vi.fn();
      render(
        <Providers>
          <Topbar
            stream={{ kind: "all" }}
            title="All"
            filter="all"
            onFilterChange={vi.fn()}
            navOpened={false}
            onToggleNav={vi.fn()}
            presentation="list"
            onPresentationChange={change}
          />
        </Providers>,
      );
      fireEvent.click(screen.getByLabelText(mode, { selector: "input" }));
      if (mode !== "list") expect(change).toHaveBeenCalledWith(mode);
      expect(
        screen.getByLabelText("cards", { selector: "input" }),
      ).toBeInTheDocument();
    },
  );

  it("hides presentation choices on Saved", () => {
    render(
      <Providers>
        <Topbar
          stream={{ kind: "starred" }}
          title="Saved"
          filter="all"
          onFilterChange={vi.fn()}
          navOpened={false}
          onToggleNav={vi.fn()}
          presentation="cards"
          onPresentationChange={vi.fn()}
        />
      </Providers>,
    );
    expect(screen.queryByLabelText("cards", { selector: "input" })).toBeNull();
  });

  it.each(["list", "cards", "swipe"] as const)(
    "renders %s and its correct end state",
    async (mode) => {
      render(
        <Providers>
          <StreamInner
            stream={{ kind: "all" }}
            filter="all"
            sort="desc"
            activeEntryId={null}
            storyIndex={0}
            onStoryIndexChange={vi.fn()}
            onSelect={vi.fn()}
            presentation={mode}
            subscriptions={[]}
          />
        </Providers>,
      );
      expect(await screen.findByText(`Rendered ${mode}`)).toBeInTheDocument();
      if (mode !== "swipe")
        expect(await screen.findByText("∎ end of stream")).toBeInTheDocument();
      else expect(screen.queryByText("∎ end of stream")).toBeNull();
    },
  );

  it.each(["today", "all", "unread", "folder", "feed", "readLater"] as const)(
    "supports the %s stream",
    async (kind) => {
      const stream = { kind, id: "1" } as StreamDescriptor;
      const select = vi.fn();
      render(
        <Providers>
          <StreamInner
            stream={stream}
            filter="all"
            sort="desc"
            activeEntryId={null}
            storyIndex={3}
            onStoryIndexChange={vi.fn()}
            onSelect={select}
            presentation="cards"
            subscriptions={[]}
          />
        </Providers>,
      );
      await screen.findByText(entry.title);
      fireEvent.click(screen.getByText("Rendered cards"));
      expect(select).toHaveBeenCalledWith(entry);
    },
  );
});

describe("Cards query and restoration", () => {
  const props = {
    stream: { kind: "all" } as StreamDescriptor,
    filter: "unread" as const,
    sort: "asc" as const,
    activeEntryId: null,
    storyIndex: 0,
    onStoryIndexChange: vi.fn(),
    onSelect: vi.fn(),
    presentation: "cards" as const,
    subscriptions: [],
  };
  it.each(["asc", "desc"] as const)(
    "preserves %s sort and filters",
    async (sort) => {
      render(
        <Providers>
          <StreamInner {...props} sort={sort} />
        </Providers>,
      );
      await screen.findByText(entry.title);
      expect(api.entries.list).toHaveBeenCalledWith(
        { kind: "all" },
        expect.objectContaining({ sort, filter: "unread", limit: 50 }),
      );
      expect(props.onSelect).not.toHaveBeenCalled();
    },
  );
  it("appends cursor pages and reaches the end without selecting articles", async () => {
    let intersect = () => {};
    const Original = window.IntersectionObserver;
    vi.spyOn(window, "IntersectionObserver").mockImplementation(
      (
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) => {
        const observer = new Original(callback, options);
        intersect = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            observer,
          );
        return observer;
      },
    );
    vi.mocked(api.entries.list)
      .mockResolvedValueOnce({ items: [entry], nextCursor: "page2" })
      .mockResolvedValue({
        items: [{ ...entry, id: "2", title: "Second page" }],
        nextCursor: null,
      });
    render(
      <Providers>
        <StreamInner {...props} />
      </Providers>,
    );
    await screen.findByText(entry.title);
    expect(screen.queryByText("∎ end of stream")).toBeNull();
    act(() => intersect());
    await screen.findByText("Second page");
    expect(document.querySelectorAll("[data-card-id]")).toHaveLength(2);
    expect(api.entries.list).toHaveBeenLastCalledWith(
      { kind: "all" },
      expect.objectContaining({ cursor: "page2" }),
    );
    expect(screen.getByText("∎ end of stream")).toBeInTheDocument();
  });
  it("keeps the selected entry across hidden reader navigation", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = (hidden: boolean) => (
      <MantineProvider>
        <QueryClientProvider client={client}>
          <StreamInner {...props} hidden={hidden} />
        </QueryClientProvider>
      </MantineProvider>
    );
    const { rerender } = render(view(false));
    await screen.findByText(entry.title);
    fireEvent.click(screen.getByText("Rendered cards"));
    rerender(view(true));
    expect(document.querySelector("[data-stream-scroll]")).toHaveAttribute(
      "inert",
    );
    expect(document.querySelector("[data-card-active]")).toHaveAttribute(
      "data-card-active",
      entry.id,
    );
    rerender(view(false));
    expect(document.querySelector("[data-card-visible]")).toHaveAttribute(
      "data-card-visible",
      "true",
    );
    expect(document.querySelector("[data-card-active]")).toHaveAttribute(
      "data-card-active",
      entry.id,
    );
  });
  it("refreshes expiring image URLs through the existing query", async () => {
    const timeout = vi.spyOn(window, "setTimeout");
    const image = {
      id: "m",
      width: 800,
      height: 600,
      alt: "",
      url: "https://stored.test/old",
      urlExpiresAtMs: Date.now() + 31000,
    };
    vi.mocked(api.entries.list)
      .mockResolvedValueOnce({
        items: [{ ...entry, articleImage: image }],
        nextCursor: null,
      })
      .mockResolvedValue({
        items: [
          {
            ...entry,
            articleImage: {
              ...image,
              url: "https://stored.test/renewed",
              urlExpiresAtMs: Date.now() + 300000,
            },
          },
        ],
        nextCursor: null,
      });
    render(
      <Providers>
        <StreamInner {...props} />
      </Providers>,
    );
    await screen.findByText(entry.title);
    const timer = timeout.mock.calls.find(
      ([, delay]) => typeof delay === "number" && delay >= 800 && delay <= 1100,
    )?.[0];
    expect(typeof timer).toBe("function");
    await waitFor(
      () =>
        expect(document.querySelector("[data-image-url]")).toHaveAttribute(
          "data-image-url",
          "https://stored.test/renewed",
        ),
      { timeout: 3000 },
    );
  });
});
