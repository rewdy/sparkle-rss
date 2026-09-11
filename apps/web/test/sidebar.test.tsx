// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { Sidebar } from "../src/components/Sidebar";
import { sidebarUnreadOnlyAtom } from "../src/lib/ui-state";

const SUB = (feedId: string, displayTitle: string) => ({
  feedId,
  url: `https://example.com/${feedId}`,
  siteUrl: "https://example.com",
  iconUrl: "",
  customTitle: null,
  feedTitle: displayTitle,
  displayTitle,
  categoryId: null,
  categoryName: null,
  entryCount: 1,
  newestEntryAtMs: null,
});

vi.mock("../src/lib/api", () => ({
  api: {
    folders: { list: vi.fn(async () => ({ folders: [] })) },
    subscriptions: {
      list: vi.fn(async () => ({
        subscriptions: [SUB("f1", "Unread Feed"), SUB("f2", "Read Feed")],
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
