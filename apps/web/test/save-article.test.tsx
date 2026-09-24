// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { SaveArticlePage } from "../src/components/SaveArticlePage";
import { ApiError } from "../src/lib/api";

vi.mock("../src/lib/api", async () => {
  class MockApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError: MockApiError,
    api: {
      readLater: { saveUrl: vi.fn(async () => ({ item: { id: "saved-1" } })) },
    },
  };
});

import { api as mockApi } from "../src/lib/api";

const SAVED_URL = "https://example.com/article";

let client: QueryClient;

function renderPage(path: string) {
  // The component reads the real location (that is how the bookmarklet's
  // popup URL arrives), so set the URL the way a browser would.
  window.history.replaceState({}, "", path);
  render(
    <Providers>
      <SaveArticlePage />
    </Providers>,
  );
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>
        <Router>{children}</Router>
      </QueryClientProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

describe("SaveArticlePage", () => {
  it("prefills the form from the query string", async () => {
    renderPage(
      `/read-later/new?url=${encodeURIComponent(SAVED_URL)}&title=From%20the%20page`,
    );
    expect(await screen.findByLabelText(/address/)).toHaveValue(SAVED_URL);
    expect(screen.getByLabelText(/title/)).toHaveValue("From the page");
    expect(mockApi.readLater.saveUrl).not.toHaveBeenCalled();
  });

  it("saves what the user typed", async () => {
    const user = userEvent.setup();
    renderPage("/read-later/new");
    await user.type(await screen.findByLabelText(/address/), SAVED_URL);
    await user.type(screen.getByLabelText(/title/), "My title");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(mockApi.readLater.saveUrl).toHaveBeenCalledWith({
        url: SAVED_URL,
        title: "My title",
        excerpt: undefined,
      }),
    );
  });

  it("does not submit an empty address", async () => {
    const user = userEvent.setup();
    renderPage("/read-later/new");
    await user.click(await screen.findByRole("button", { name: "save" }));
    expect(mockApi.readLater.saveUrl).not.toHaveBeenCalled();
  });

  it("auto-submits once when the bookmarklet sets auto=1", async () => {
    renderPage(
      `/read-later/new?url=${encodeURIComponent(SAVED_URL)}&title=From%20the%20page&auto=1`,
    );
    await waitFor(() =>
      expect(mockApi.readLater.saveUrl).toHaveBeenCalledWith({
        url: SAVED_URL,
        title: "From the page",
        excerpt: undefined,
      }),
    );
    expect(mockApi.readLater.saveUrl).toHaveBeenCalledTimes(1);
  });

  it("explains a rejected address instead of failing silently", async () => {
    vi.mocked(mockApi.readLater.saveUrl).mockRejectedValueOnce(
      new ApiError(400, "400 Bad Request"),
    );
    const user = userEvent.setup();
    renderPage(`/read-later/new?url=${encodeURIComponent(SAVED_URL)}`);
    await user.click(await screen.findByRole("button", { name: "save" }));
    expect(
      await screen.findByText(/that address can't be saved/),
    ).toBeInTheDocument();
  });

  it("keeps the bookmarklet behind a collapsed section", async () => {
    const user = userEvent.setup();
    renderPage("/read-later/new");
    const control = await screen.findByRole("button", {
      name: /save articles with one click/,
    });
    // collapsed: the draggable link is not rendered until the section opens
    expect(
      screen.queryByRole("link", { name: "Read later" }),
    ).not.toBeInTheDocument();

    await user.click(control);
    const link = await screen.findByRole("link", { name: "Read later" });
    expect(link.getAttribute("href") ?? "").toContain("javascript:");
    expect(link.getAttribute("href") ?? "").toContain("/read-later/new?");
  });

  it("does not submit the form when the bookmarklet section is toggled", async () => {
    const user = userEvent.setup();
    renderPage(`/read-later/new?url=${encodeURIComponent(SAVED_URL)}`);
    await user.click(
      await screen.findByRole("button", {
        name: /save articles with one click/,
      }),
    );
    expect(mockApi.readLater.saveUrl).not.toHaveBeenCalled();
  });
});
