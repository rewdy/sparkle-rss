// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscribeModal } from "../src/components/SubscribeModal";

vi.mock("../src/lib/api", () => ({
  api: {
    subscriptions: {
      subscribe: vi.fn(async ({ url }: { url: string }) => ({
        subscription: { feedId: "x", url },
      })),
    },
  },
}));

import { MantineProvider } from "@mantine/core";
import { api as mockApi } from "../src/lib/api";

const user = userEvent.setup();
let client: QueryClient;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

function renderModal(onClose: () => void = vi.fn()) {
  render(
    <Providers>
      <SubscribeModal opened folders={[]} onClose={onClose} />
    </Providers>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("SubscribeModal", () => {
  it("requires a URL before submitting", async () => {
    renderModal();
    const submit = screen.getByRole("button", { name: "subscribe" });
    await user.click(submit);
    expect(mockApi.subscriptions.subscribe).not.toHaveBeenCalled();
  });

  it("flags a non-http URL as invalid", async () => {
    renderModal();
    await user.type(screen.getByLabelText("feed or site URL"), "not a url");
    expect(screen.getByText(/must start with http/)).toBeInTheDocument();
  });

  it("submits a valid URL and closes the dialog", async () => {
    const onClose = vi.fn();
    renderModal(onClose);
    await user.type(
      screen.getByLabelText("feed or site URL"),
      "https://example.com/blog",
    );
    await user.click(screen.getByRole("button", { name: "subscribe" }));
    await waitFor(() =>
      expect(mockApi.subscriptions.subscribe).toHaveBeenCalledWith(
        "https://example.com/blog",
        {
          folderId: null,
          title: undefined,
        },
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a generic error and keeps the dialog open when adding fails", async () => {
    const onClose = vi.fn();
    vi.mocked(mockApi.subscriptions.subscribe).mockRejectedValueOnce(
      new Error("no feed"),
    );
    renderModal(onClose);
    await user.type(
      screen.getByLabelText("feed or site URL"),
      "https://example.com/not-a-feed",
    );
    await user.click(screen.getByRole("button", { name: "subscribe" }));

    expect(await screen.findByText("Could not add feed")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByDisplayValue("https://example.com/not-a-feed"),
    ).toBeInTheDocument();
  });

  it("clears the error and closes after a successful retry", async () => {
    const onClose = vi.fn();
    vi.mocked(mockApi.subscriptions.subscribe)
      .mockRejectedValueOnce(new Error("no feed"))
      .mockResolvedValueOnce({
        subscription: { feedId: "x", url: "https://example.com/feed" },
      });
    renderModal(onClose);
    await user.type(
      screen.getByLabelText("feed or site URL"),
      "https://example.com/feed",
    );
    await user.click(screen.getByRole("button", { name: "subscribe" }));
    expect(await screen.findByText("Could not add feed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "subscribe" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText("Could not add feed")).not.toBeInTheDocument();
  });

  it("sends the custom title when provided", async () => {
    renderModal();
    await user.type(
      screen.getByLabelText("feed or site URL"),
      "https://example.com/blog",
    );
    await user.type(
      screen.getByLabelText("custom title (optional)"),
      "My Feed",
    );
    await user.click(screen.getByRole("button", { name: "subscribe" }));
    await waitFor(() =>
      expect(mockApi.subscriptions.subscribe).toHaveBeenCalledWith(
        "https://example.com/blog",
        expect.objectContaining({ title: "My Feed" }),
      ),
    );
  });
});
