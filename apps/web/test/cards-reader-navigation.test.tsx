// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../src/lib/types";
import { markReadOnOpenAtom, storyPresentationAtom } from "../src/lib/ui-state";
import { Shell } from "../src/pages/Shell";

const mutations = vi.hoisted(() => ({ read: vi.fn(), laterRead: vi.fn() }));
vi.mock("../src/pages/guard", () => ({
  useAuthGuard: () => "authed",
  FullscreenLoader: () => null,
  SessionRestoreError: () => null,
}));
vi.mock("../src/lib/mutations", () => ({
  useMarkRead: () => ({ mutate: mutations.read }),
  useMarkReadLater: () => ({ mutate: mutations.laterRead }),
  useToggleStar: () => ({ mutate: vi.fn() }),
  useToggleReadLater: () => ({ mutate: vi.fn() }),
  useRemoveReadLater: () => ({ mutate: vi.fn() }),
  useMarkAllRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("../src/components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../src/components/ReaderPane", () => ({
  ReaderPane: ({ entry }: { entry: Entry }) => <div>Reading {entry.id}</div>,
}));
vi.mock("../src/components/CardsView", () => ({
  CardsView: ({
    entries,
    onSelect,
    activeId,
  }: {
    entries: Entry[];
    onSelect: (entry: Entry) => void;
    activeId: string | null;
  }) => (
    <div data-restored-card={activeId}>
      {entries.map((entry) => (
        <button type="button" key={entry.id} onClick={() => onSelect(entry)}>
          Card {entry.id}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../src/components/SavedList", () => ({
  SavedList: () => <div>Dedicated saved layout</div>,
}));
const entries: Entry[] = ["1", "2", "3"].map((id) => ({
  id,
  feedId: "1",
  title: `Story ${id}`,
  url: "https://example.test",
  author: "Ada",
  contentHtml: "",
  publishedAtMs: Date.now(),
  crawledAtMs: Date.now(),
  enclosures: [],
  isRead: false,
  isStarred: false,
  isReadLater: false,
  articleImage: null,
}));
vi.mock("../src/lib/api", () => ({
  ApiError: Error,
  api: {
    subscriptions: { list: async () => ({ subscriptions: [] }) },
    folders: { list: async () => ({ folders: [] }) },
    settings: { get: async () => ({ data: {} }) },
    entries: {
      list: async () => ({ items: entries, nextCursor: null }),
      get: async (id: string) => ({
        entry: entries.find((entry) => entry.id === id),
      }),
    },
    saved: { list: async () => ({ items: [], nextCursor: null }) },
  },
}));
let store: ReturnType<typeof createStore>;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/all?filter=unread&sort=asc");
  store = createStore();
  store.set(storyPresentationAtom, "cards");
  store.set(markReadOnOpenAtom, true);
});
afterEach(cleanup);
function mount() {
  return render(
    <MantineProvider>
      <Provider store={store}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <Shell />
        </QueryClientProvider>
      </Provider>
    </MantineProvider>,
  );
}

describe("Cards reader navigation", () => {
  it.each([true, false])(
    "opens the existing route with mark-on-open %s",
    async (enabled) => {
      store.set(markReadOnOpenAtom, enabled);
      mount();
      fireEvent.click(await screen.findByText("Card 1"));
      expect(await screen.findByText("Reading 1")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/all/e/1");
      expect(window.location.search).toBe("?filter=unread&sort=asc");
      if (enabled)
        expect(mutations.read).toHaveBeenCalledWith({ ids: ["1"], read: true });
      else expect(mutations.read).not.toHaveBeenCalled();
      expect(document.querySelector("[data-stream-scroll]")).toHaveAttribute(
        "inert",
      );
    },
  );
  it("keeps j/k in stream order and restores Cards through browser Back and Escape", async () => {
    mount();
    fireEvent.click(await screen.findByText("Card 1"));
    await screen.findByText("Reading 1");
    fireEvent.keyDown(window, { key: "j" });
    await screen.findByText("Reading 2");
    fireEvent.keyDown(window, { key: "k" });
    await screen.findByText("Reading 1");
    window.history.back();
    await screen.findByText("Reading 2");
    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByText("Reading 1");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Reading 1")).toBeNull());
    expect(window.location.pathname).toBe("/all");
    expect(store.get(storyPresentationAtom)).toBe("cards");
    expect(document.querySelector("[data-restored-card]")).toHaveAttribute(
      "data-restored-card",
      "1",
    );
    expect(document.querySelector("[data-stream-scroll]")).not.toHaveAttribute(
      "inert",
    );
  });
  it("opens read-later cards using the read-later mutation", async () => {
    window.history.replaceState(null, "", "/read-later");
    mount();
    fireEvent.click(await screen.findByText("Card 1"));
    await screen.findByText("Reading 1");
    expect(window.location.pathname).toBe("/read-later/e/1");
    expect(mutations.laterRead).toHaveBeenCalledWith({
      ids: ["1"],
      read: true,
    });
    expect(mutations.read).not.toHaveBeenCalled();
  });
  it("retains Cards preference on Saved and suppresses the presentation selector", async () => {
    window.history.replaceState(null, "", "/starred");
    mount();
    await screen.findByText("Dedicated saved layout");
    expect(screen.queryByLabelText("cards", { selector: "input" })).toBeNull();
    expect(store.get(storyPresentationAtom)).toBe("cards");
    expect(mutations.read).not.toHaveBeenCalled();
  });
});
