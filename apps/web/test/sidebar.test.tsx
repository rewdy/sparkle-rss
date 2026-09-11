// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { Sidebar } from "../src/components/Sidebar";
import {
  collapsedFoldersAtom,
  sidebarUnreadOnlyAtom,
} from "../src/lib/ui-state";

const SUB = (
  feedId: string,
  displayTitle: string,
  categoryId: string | null = null,
) => ({
  feedId,
  url: `https://example.com/${feedId}`,
  siteUrl: "https://example.com",
  iconUrl: "",
  customTitle: null,
  feedTitle: displayTitle,
  displayTitle,
  categoryId,
  categoryName: null,
  entryCount: 1,
  newestEntryAtMs: null,
});

vi.mock("../src/lib/api", () => ({
  api: {
    folders: {
      list: vi.fn(async () => ({
        folders: [{ id: "c1", name: "Tech", feedCount: 1, unreadCount: 1 }],
      })),
    },
    subscriptions: {
      list: vi.fn(async () => ({
        subscriptions: [SUB("f1", "Unread Feed", "c1"), SUB("f2", "Read Feed")],
      })),
    },
    unreadCounts: vi.fn(async () => ({
      total: 1,
      feeds: [{ feedId: "f1", count: 1, newestMs: null }],
      folders: [],
    })),
    settings: { put: vi.fn(async () => ({ data: {} })) },
  },
}));

import userEvent from "@testing-library/user-event";

let client: QueryClient;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>
        <Router ssrPath="/all">{children}</Router>
      </QueryClientProvider>
    </MantineProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  getDefaultStore().set(sidebarUnreadOnlyAtom, false);
  getDefaultStore().set(collapsedFoldersAtom, []);
});

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("Sidebar unread-only filter", () => {
  it("shows every feed when the filter is off", async () => {
    render(
      <Providers>
        <Sidebar />
      </Providers>,
    );
    expect(await screen.findByText("Unread Feed")).toBeInTheDocument();
    expect(screen.getByText("Read Feed")).toBeInTheDocument();
  });

  it("hides feeds with no unread when the filter is on", async () => {
    getDefaultStore().set(sidebarUnreadOnlyAtom, true);
    render(
      <Providers>
        <Sidebar />
      </Providers>,
    );
    expect(await screen.findByText("Unread Feed")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Read Feed")).not.toBeInTheDocument(),
    );
  });
});

describe("Sidebar sections", () => {
  it("renders Streams and Feeds headings", async () => {
    render(
      <Providers>
        <Sidebar />
      </Providers>,
    );
    expect(await screen.findByText("feeds")).toBeInTheDocument();
    expect(screen.getByText("streams")).toBeInTheDocument();
  });

  it("opens an add menu with feed and folder actions", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <Sidebar />
      </Providers>,
    );
    await user.click(await screen.findByRole("button", { name: "add" }));
    expect(await screen.findByText("add feed…")).toBeInTheDocument();
    expect(screen.getByText("add folder…")).toBeInTheDocument();
  });

  it("toggles unread-only from the feed list options menu", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <Sidebar />
      </Providers>,
    );
    expect(await screen.findByText("Read Feed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "feed list options" }));
    await user.click(await screen.findByLabelText("unread only"));
    await waitFor(() =>
      expect(screen.queryByText("Read Feed")).not.toBeInTheDocument(),
    );
  });

  it("collapses and expands a folder via its icon", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <Sidebar />
      </Providers>,
    );
    expect(await screen.findByText("Unread Feed")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "collapse folder Tech" }),
    );
    expect(screen.queryByText("Unread Feed")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "expand folder Tech" }),
    ).toBeInTheDocument();
  });
});
