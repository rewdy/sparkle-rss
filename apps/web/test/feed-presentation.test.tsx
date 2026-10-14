// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  EntryList: ({
    presentation,
    onSelect,
  }: {
    presentation: string;
    onSelect: (e: Entry) => void;
  }) => (
    <button type="button" onClick={() => onSelect(entry)}>
      Rendered {presentation}
    </button>
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
afterEach(cleanup);

describe("Feed integration", () => {
  it.each(["list", "feed", "swipe"] as const)(
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
        screen.getByLabelText("feed", { selector: "input" }),
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
          presentation="feed"
          onPresentationChange={vi.fn()}
        />
      </Providers>,
    );
    expect(screen.queryByLabelText("feed", { selector: "input" })).toBeNull();
  });

  it.each(["list", "feed", "swipe"] as const)(
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
            presentation="feed"
            subscriptions={[]}
          />
        </Providers>,
      );
      fireEvent.click(await screen.findByText("Rendered feed"));
      expect(select).toHaveBeenCalledWith(entry);
    },
  );
});
