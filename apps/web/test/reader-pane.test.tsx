// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderPane } from "../src/components/ReaderPane";
import type { Entry } from "../src/lib/types";

// The pane reads subscriptions and issues read/star mutations; route those
// through a fake api so no real network happens.
vi.mock("../src/lib/api", () => ({
  api: {
    savedImages: {
      listForSource: vi.fn(async () => ({ items: [] })),
      save: vi.fn(),
    },
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
    entries: {
      setRead: vi.fn(async () => ({ updated: 0 })),
      setStarred: vi.fn(async () => ({ updated: 0 })),
    },
    readLater: {
      saveEntries: vi.fn(async () => ({ updated: 0 })),
      setRead: vi.fn(async () => ({ updated: 0 })),
      remove: vi.fn(async () => ({ removed: 0 })),
    },
  },
}));

import { MantineProvider } from "@mantine/core";
import { api as mockApi } from "../src/lib/api";

const ENTRY: Entry = {
  id: "42",
  feedId: "f1",
  title: "Postgres at the edge",
  url: "https://example.com/post",
  author: "Ada",
  contentHtml: '<p>hello <img src="https://example.com/a.png" /></p>',
  publishedAtMs: Date.UTC(2026, 7, 26, 14, 0),
  crawledAtMs: Date.UTC(2026, 7, 26, 14, 0),
  enclosures: [],
  isRead: false,
  isStarred: false,
  isReadLater: false,
  articleImage: null,
};

let client: QueryClient;
const user = userEvent.setup();

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

function renderPane(props: Partial<Parameters<typeof ReaderPane>[0]> = {}) {
  render(
    <Providers>
      <ReaderPane
        entry={ENTRY}
        onClose={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        {...props}
      />
    </Providers>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReaderPane", () => {
  it("renders the article title and its content", () => {
    renderPane();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Postgres at the edge",
    );
    expect(document.querySelector(".reading-content")).toHaveTextContent(
      "hello",
    );
  });

  it("shows a byline with the feed, author, and date", async () => {
    renderPane();
    expect(await screen.findByText(/Example Feed • Ada/)).toBeInTheDocument();
  });

  it("marks content images lazy and async after mount", () => {
    renderPane();
    const img = document.querySelector(
      ".reading-content img",
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.loading).toBe("lazy");
    expect(img?.decoding).toBe("async");
  });

  it("calls onClose from the back button", async () => {
    const onClose = vi.fn();
    renderPane({ onClose });
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles read via the read action", async () => {
    renderPane();
    await user.click(screen.getByRole("button", { name: "toggle read" }));
    expect(mockApi.entries.setRead).toHaveBeenCalledWith(["42"], true);
  });

  it("saves an entry via the save action", async () => {
    renderPane();
    await user.click(screen.getByRole("button", { name: "save" }));
    expect(mockApi.entries.setStarred).toHaveBeenCalledWith(["42"], true);
  });

  it("adds a feed entry to read later", async () => {
    renderPane();
    await user.click(screen.getByRole("button", { name: "read later" }));
    expect(mockApi.readLater.saveEntries).toHaveBeenCalledWith(["42"], true);
  });

  it("offers removal instead of saving when opened from the queue", async () => {
    renderPane({ readLater: true });
    expect(
      screen.queryByRole("button", { name: "read later" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "remove from read later" }),
    );
    expect(mockApi.readLater.remove).toHaveBeenCalledWith(["42"]);
  });

  it("hides star and read-later toggles for a saved URL", async () => {
    renderPane({
      readLater: true,
      entry: { ...ENTRY, id: "item-uuid", source: "url", siteName: "Example" },
    });
    expect(
      screen.queryByRole("button", { name: "save" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText(/Example/)).toBeInTheDocument();
    // read state is per-item for saved URLs
    expect(
      screen.getByRole("button", { name: "remove from read later" }),
    ).toBeInTheDocument();
  });

  it("wires previous and next to the reader nav buttons", async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderPane({ onNext, onPrev });
    await user.click(screen.getByRole("button", { name: /next/ }));
    await user.click(screen.getByRole("button", { name: /previous/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});

describe("reader image saving", () => {
  it("saves the selected image without starring the article", async () => {
    vi.mocked(mockApi.savedImages.save).mockResolvedValue({
      item: { id: "saved-image", imageSourceUrl: "https://example.com/a.png" },
    } as never);
    renderPane();
    await user.click(screen.getByRole("button", { name: "save image" }));
    expect(mockApi.savedImages.save).toHaveBeenCalledWith({
      source: { kind: "entry", id: "42" },
      imageUrl: "https://example.com/a.png",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "image saved" }),
      ).toBeDisabled(),
    );
    expect(mockApi.entries.setStarred).not.toHaveBeenCalled();
  });
  it("offers retry after failure and does not show success prematurely", async () => {
    vi.mocked(mockApi.savedImages.save).mockRejectedValueOnce(
      new Error("storage failed"),
    );
    renderPane();
    await user.click(screen.getByRole("button", { name: "save image" }));
    expect(
      await screen.findByRole("button", { name: "retry saving image" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "image saved" }),
    ).not.toBeInTheDocument();
  });
  it("keeps controls outside linked images and preserves text links", () => {
    renderPane({
      entry: {
        ...ENTRY,
        contentHtml:
          '<a href="https://example.com/full">text<img src="/a.png" alt="diagram"></a>',
      },
    });
    const control = screen.getByRole("button", { name: "save image: diagram" });
    expect(control.closest("a")).toBeNull();
    const image = document.querySelector(".reading-content img");
    expect(image?.closest("a")?.href).toBe("https://example.com/full");
    expect(screen.getByText("text").closest("a")?.href).toBe(
      "https://example.com/full",
    );
  });
  it("supports keyboard activation", async () => {
    vi.mocked(mockApi.savedImages.save).mockResolvedValue({
      item: { id: "keyboard-image" },
    } as never);
    renderPane();
    const control = screen.getByRole("button", { name: "save image" });
    control.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(mockApi.savedImages.save).toHaveBeenCalledTimes(1),
    );
  });
  it("updates controls when content changes without changing the entry ID", () => {
    const view = render(
      <Providers>
        <ReaderPane
          entry={ENTRY}
          onClose={vi.fn()}
          onNext={vi.fn()}
          onPrev={vi.fn()}
        />
      </Providers>,
    );
    view.rerender(
      <Providers>
        <ReaderPane
          entry={{
            ...ENTRY,
            contentHtml:
              '<figure><img src="/b.png" alt="new"><figcaption>caption</figcaption></figure>',
          }}
          onClose={vi.fn()}
          onNext={vi.fn()}
          onPrev={vi.fn()}
        />
      </Providers>,
    );
    expect(screen.getAllByRole("button", { name: /save image/ })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "save image: new" }),
    ).toBeInTheDocument();
    expect(screen.getByText("caption")).toBeInTheDocument();
  });
  it("uses read-later source identity for URL articles", async () => {
    vi.mocked(mockApi.savedImages.save).mockResolvedValue({
      item: { id: "url-image" },
    } as never);
    renderPane({
      readLater: true,
      entry: { ...ENTRY, id: "url-item", source: "url" },
    });
    await user.click(screen.getByRole("button", { name: "save image" }));
    expect(mockApi.savedImages.save).toHaveBeenCalledWith({
      source: { kind: "read-later", id: "url-item" },
      imageUrl: "https://example.com/a.png",
    });
  });
});
