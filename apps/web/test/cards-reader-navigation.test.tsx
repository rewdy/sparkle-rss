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
import { ApiError } from "../src/lib/api";
import { qk } from "../src/lib/keys";
import type { Entry } from "../src/lib/types";
import {
  markReadOnOpenAtom,
  streamPresentationAtom,
} from "../src/lib/ui-state";
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
  ReaderPane: ({
    entry,
    onClose,
    onNext,
    nextStatus,
  }: {
    entry: Entry;
    onClose: () => void;
    onNext: () => void;
    nextStatus: string;
  }) => (
    <div>
      Reading {entry.id}
      <button type="button" onClick={onClose}>
        back
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextStatus === "loading"}
      >
        {nextStatus === "error" ? "Retry next" : "Next"}
      </button>
      <span role="status">{nextStatus}</span>
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
const requests = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("../src/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number) {
      super();
    }
  },
  api: {
    subscriptions: { list: async () => ({ subscriptions: [] }) },
    folders: { list: async () => ({ folders: [] }) },
    settings: { get: async () => ({ data: {} }) },
    entries: {
      list: requests.list,
      get: requests.get,
    },
    saved: { list: async () => ({ items: [], nextCursor: null }) },
  },
}));
let store: ReturnType<typeof createStore>;
beforeEach(() => {
  vi.clearAllMocks();
  requests.list
    .mockReset()
    .mockResolvedValue({ items: entries, nextCursor: null });
  requests.get.mockReset().mockImplementation(async (id: string) => ({
    entry: entries.find((entry) => entry.id === id),
  }));
  window.history.replaceState(null, "", "/all?filter=unread&sort=asc");
  store = createStore();
  store.set(streamPresentationAtom, "cards");
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
      expect(store.get(streamPresentationAtom)).toBe("cards");
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
  it.each(["browser", "button", "Escape"])(
    "normalizes a reloaded legacy origin via %s and preserves Forward",
    async (action) => {
      const key = "sparkle.readerNavigation";
      const origin = "/all/story/2?filter=unread&sort=asc";
      const surfaceState = {
        other: "retained",
        [key]: { version: 1, kind: "surface", surfaceId: "legacy" },
      };
      window.history.replaceState(surfaceState, "", origin);
      window.history.pushState(
        { [key]: { version: 1, kind: "reader", surfaceId: "legacy", origin } },
        "",
        "/all/e/2?filter=unread&sort=asc",
      );

      mount();
      await screen.findByText("Reading 2");
      if (action === "browser") window.history.back();
      else if (action === "button") fireEvent.click(screen.getByText("back"));
      else fireEvent.keyDown(window, { key: "Escape" });

      await waitFor(() => expect(window.location.pathname).toBe("/all"));
      await screen.findByText("Card 1");
      expect(window.location.search).toBe("?filter=unread&sort=asc");
      expect(window.history.state).toEqual(surfaceState);
      expect(mutations.read).not.toHaveBeenCalled();
      window.history.forward();
      await screen.findByText("Reading 2");
    },
  );

  it.each([
    ["/feed/5", "?filter=unread&sort=asc"],
    ["/starred", "?sort=asc"],
  ])("replaces a direct story URL for %s", async (parent, search) => {
    window.history.replaceState(
      null,
      "",
      `${parent}/story/4?filter=unread&sort=asc`,
    );
    const length = window.history.length;
    mount();
    await waitFor(() => expect(window.location.pathname).toBe(parent));
    expect(window.location.search).toBe(search);
    expect(window.history.length).toBe(length);
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
    expect(store.get(streamPresentationAtom)).toBe("cards");
    expect(mutations.read).not.toHaveBeenCalled();
  });
});

describe("Channel end view", () => {
  it.each([
    ["all", "All"],
    ["unread", "Unread"],
    ["today", "Today"],
  ])(
    "opens the %s end without a mutation and returns to the same cards",
    async (path, name) => {
      window.history.replaceState(null, "", `/${path}?filter=unread&sort=asc`);
      mount();
      fireEvent.click(await screen.findByText("Card 3"));
      await screen.findByText("Reading 3");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      const heading = await screen.findByRole("heading", {
        name: "You’re at the end!",
      });
      expect(heading).toHaveFocus();
      expect(mutations.read).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(window, { key: "m" });
      fireEvent.keyDown(window, { key: "A", shiftKey: true });
      expect(mutations.read).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(window, { key: "k" });
      await screen.findByText("Reading 3");
      fireEvent.keyDown(window, { key: "j" });
      fireEvent.click(
        await screen.findByRole("link", { name: `Back to ${name}` }),
      );
      await waitFor(() => expect(window.location.pathname).toBe(`/${path}`));
      expect(window.location.search).toBe("?filter=unread&sort=asc");
      expect(document.querySelector("[data-restored-card]")).toHaveAttribute(
        "data-restored-card",
        "3",
      );
      window.history.forward();
      await screen.findByRole("heading", { name: "You’re at the end!" });
    },
  );

  it("returns safely when the previous article no longer exists", async () => {
    window.history.replaceState(null, "", "/unread/e/9/end");
    requests.get.mockImplementation(async () => {
      throw new ApiError(404, "missing");
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /previous/ }));
    await screen.findByText("The previous story is unavailable.");
    fireEvent.click(screen.getByRole("link", { name: "Back to Unread" }));
    expect(window.location.pathname).toBe("/unread");
    expect(mutations.read).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "loads available cursor pages before deciding whether to finish (%s)",
    async (hasSuccessor) => {
      requests.list.mockImplementation(async (_stream, options) => {
        if (!options.cursor)
          return { items: entries.slice(0, 1), nextCursor: "second" };
        if (options.cursor === "second")
          return { items: [], nextCursor: "third" };
        return {
          items: hasSuccessor ? entries.slice(1) : [],
          nextCursor: null,
        };
      });
      mount();
      fireEvent.click(await screen.findByText("Card 1"));
      fireEvent.keyDown(window, { key: "j" });
      if (hasSuccessor) await screen.findByText("Reading 2");
      else await screen.findByRole("heading", { name: "You’re at the end!" });
    },
  );

  it("retries a failed page, coalesces repeated steps, and stays closed after leaving", async () => {
    const pending = Promise.withResolvers<{
      items: Entry[];
      nextCursor: null;
    }>();
    const nextPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValue(pending.promise);
    requests.list.mockImplementation(async (_stream, options) =>
      options.cursor
        ? nextPage()
        : { items: entries.slice(0, 1), nextCursor: "second" },
    );
    mount();
    fireEvent.click(await screen.findByText("Card 1"));
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.click(await screen.findByRole("button", { name: "Retry next" }));
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(nextPage).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Reading 1")).toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.location.pathname).toBe("/all"));
    await act(async () => {
      pending.resolve({ items: entries.slice(1), nextCursor: null });
    });
    await screen.findByText("Card 2");
    expect(window.location.pathname).toBe("/all");
    expect(mutations.read).toHaveBeenCalledTimes(1);
  });

  it("keeps the boundary behavior for other streams and empty channels", async () => {
    window.history.replaceState(null, "", "/feed/5");
    const { unmount } = mount();
    fireEvent.click(await screen.findByText("Card 3"));
    fireEvent.keyDown(window, { key: "j" });
    expect(window.location.pathname).toBe("/feed/5/e/3");
    unmount();
    requests.list.mockResolvedValue({ items: [], nextCursor: null });
    window.history.replaceState(null, "", "/today");
    mount();
    await waitFor(() =>
      expect(requests.list).toHaveBeenCalledWith(
        { kind: "today" },
        expect.anything(),
      ),
    );
    fireEvent.keyDown(window, { key: "j" });
    expect(window.location.pathname).toBe("/today");
  });
});
