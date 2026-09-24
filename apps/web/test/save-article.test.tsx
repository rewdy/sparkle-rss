// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import type { SaveArticleVariant } from "../src/components/SaveArticleForm";
import { SaveArticleForm } from "../src/components/SaveArticleForm";
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

function renderPage(path: string, variant: SaveArticleVariant = "page") {
  // The form reads the real location (that is how the bookmarklet's popup URL
  // arrives), so set the URL the way a browser would.
  window.history.replaceState({}, "", path);
  render(
    <Providers>
      <SaveArticleForm variant={variant} />
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

describe("SaveArticleForm", () => {
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

  it("shows the prefilled form without submitting when the bookmarklet opens it", async () => {
    renderPage(
      `/read-later/new?url=${encodeURIComponent(SAVED_URL)}&title=From%20the%20page`,
      "popup",
    );
    expect(await screen.findByLabelText(/address/)).toHaveValue(SAVED_URL);
    expect(screen.getByLabelText(/title/)).toHaveValue("From the page");
    expect(mockApi.readLater.saveUrl).not.toHaveBeenCalled();
  });

  it("drops the intro copy and field hints in the popup variant", async () => {
    renderPage("/read-later/new", "popup");
    await screen.findByLabelText(/address/);
    expect(
      screen.queryByText(/Paste a link to keep it/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/optional; taken from/)).not.toBeInTheDocument();
    expect(screen.queryByText(/optional; quoted text/)).not.toBeInTheDocument();
  });

  it("keeps the intro copy and field hints in the page variant", async () => {
    renderPage("/read-later/new");
    await screen.findByLabelText(/address/);
    expect(screen.getByText(/Paste a link to keep it/)).toBeInTheDocument();
    expect(screen.getByText(/optional; taken from/)).toBeInTheDocument();
    expect(screen.getByText(/optional; quoted text/)).toBeInTheDocument();
  });

  it("confirms in place instead of navigating away in the bookmarklet popup", async () => {
    const user = userEvent.setup();
    renderPage(`/read-later/new?url=${encodeURIComponent(SAVED_URL)}`, "popup");
    await user.click(await screen.findByRole("button", { name: "save" }));

    expect(
      await screen.findByRole("heading", { name: "saved" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "close" })).toBeInTheDocument();
    // The form is replaced by the confirmation, so the popup cannot resubmit.
    expect(screen.queryByLabelText(/address/)).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/read-later/new");
  });

  it("opens the saved item when saved from inside the app", async () => {
    const user = userEvent.setup();
    renderPage("/read-later/new");
    await user.type(await screen.findByLabelText(/address/), SAVED_URL);
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/read-later/e/saved-1"),
    );
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

  it("does not offer bookmarklet setup on the form", async () => {
    renderPage("/read-later/new");
    await screen.findByLabelText(/address/);
    // Setting the bookmarklet up lives in Settings; the form is just the form.
    expect(
      screen.queryByText(/save articles with one click/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Read later" }),
    ).not.toBeInTheDocument();
  });
});
