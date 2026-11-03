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
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "../src/lib/keys";
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
  ReaderPane: ({ entry, onClose }: { entry: Entry; onClose: () => void }) => (
    <div>
      Reading {entry.id}
      <button type="button" onClick={onClose}>
        back
      </button>
    </div>
  ),
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
vi.mock("../src/components/StoryView", () => ({
  StoryView: ({
    entries,
    onRead,
    onActiveIndexChange,
    activeIndex,
  }: {
    entries: Entry[];
    onRead: (entry: Entry) => void;
    onActiveIndexChange: (index: number) => void;
    activeIndex: number;
  }) => (
    <div data-story-position={activeIndex}>
      <button
        type="button"
        disabled={!entries.length}
        onClick={() => entries[0] && onRead(entries[0])}
      >
        read story
      </button>
      <button type="button" onClick={() => onActiveIndexChange(0)}>
        observer callback
      </button>
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
function mount(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <MantineProvider>
      <Provider store={store}>
        <QueryClientProvider client={client}>
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
  it.each(["browser", "button", "Escape"])(
    "returns directly via %s and Forward reopens the final article",
    async (action) => {
      mount();
      fireEvent.click(await screen.findByText("Card 1"));
      await screen.findByText("Reading 1");
      fireEvent.keyDown(window, { key: "j" });
      await screen.findByText("Reading 2");
      if (action === "browser") window.history.back();
      else if (action === "button") fireEvent.click(screen.getByText("back"));
      else fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(window.location.pathname).toBe("/all"));
      expect(window.location.search).toBe("?filter=unread&sort=asc");
      expect(store.get(storyPresentationAtom)).toBe("cards");
      expect(document.querySelector("[data-restored-card]")).toHaveAttribute(
        "data-restored-card",
        "2",
      );
      window.history.forward();
      await screen.findByText("Reading 2");
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(window.location.pathname).toBe("/all"));
    },
  );
  it("keyboard opening pushes once and boundary steps do not add entries", async () => {
    mount();
    await screen.findByText("Card 1");
    fireEvent.keyDown(window, { key: "k" });
    await screen.findByText("Reading 3");
    const length = window.history.length;
    fireEvent.keyDown(window, { key: "j" });
    expect(window.history.length).toBe(length);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.location.pathname).toBe("/all"));
  });
  it("direct entry closes to its parent despite unrelated prior history", async () => {
    window.history.pushState(null, "", "/all/e/2?sort=asc");
    mount();
    await screen.findByText("Reading 2");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.location.pathname).toBe("/all"));
    expect(window.location.search).toBe("?sort=asc");
  });
  it("restores Swipe origin after stepping and remount", async () => {
    window.history.replaceState(null, "", "/all/story/2?sort=asc");
    store.set(storyPresentationAtom, "swipe");
    const view = mount();
    await waitFor(() => expect(screen.getByText("read story")).toBeEnabled());
    fireEvent.click(screen.getByText("read story"));
    await screen.findByText("Reading 1");
    expect(window.location.pathname).toBe("/all/e/1");
    fireEvent.keyDown(window, { key: "j" });
    await screen.findByText("Reading 2");
    view.unmount();
    mount();
    await screen.findByText("Reading 2");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.location.pathname).toBe("/all/story/2"));
    expect(window.location.search).toBe("?sort=asc");
    expect(document.querySelector("[data-story-position]")).toHaveAttribute(
      "data-story-position",
      "2",
    );
  });
  it("can return when the last viewed article has left the loaded stream", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mount(client);
    fireEvent.click(await screen.findByText("Card 2"));
    await screen.findByText("Reading 2");
    act(() =>
      client.setQueryData(qk.entries({ kind: "all" }, "unread", "asc"), {
        pages: [
          {
            items: entries.filter((entry) => entry.id !== "2"),
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.location.pathname).toBe("/all"));
    expect(screen.queryByText("Reading 2")).toBeNull();
    expect(screen.queryByText("Card 2")).toBeNull();
    expect(screen.getByText("Card 1")).toBeInTheDocument();
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
