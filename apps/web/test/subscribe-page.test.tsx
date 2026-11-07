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
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscribePage } from "../src/components/SubscribePage";

vi.mock("../src/lib/api", () => ({
  api: {
    subscriptions: { discover: vi.fn(), subscribe: vi.fn() },
    folders: { list: vi.fn() },
  },
}));

import { api } from "../src/lib/api";

const source = "https://blog.test/post?q=é&next=2#comments";
const query = (url = source, title = "Page title") =>
  new URLSearchParams({ url, title, popup: "1" }).toString();
const feed = {
  feedUrl: "https://blog.test/rss",
  siteUrl: "https://blog.test/",
  title: "Blog",
};
let client: QueryClient;
function mount(search = query()) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <SubscribePage search={search} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(api.subscriptions.discover).mockResolvedValue({ feed });
  vi.mocked(api.subscriptions.subscribe).mockResolvedValue({
    subscription: { feedId: "1" },
  } as never);
  vi.mocked(api.folders.list).mockResolvedValue({
    folders: [{ id: "7", name: "Blogs", feedCount: 0 }],
  } as never);
  vi.spyOn(window, "close").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("subscription popup", () => {
  it("previews without writes and submits the resolved feed with title/folder only on confirmation", async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText("Subscribe to Blog?")).toBeInTheDocument();
    expect(api.subscriptions.subscribe).not.toHaveBeenCalled();
    expect(screen.getByText(feed.feedUrl)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Custom title (optional)"),
      "My Blog",
    );
    await user.selectOptions(screen.getByLabelText("Folder"), "7");
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(await screen.findByText("Subscribed!")).toBeInTheDocument();
    expect(api.subscriptions.subscribe).toHaveBeenCalledWith(feed.feedUrl, {
      title: "My Blog",
      folderId: 7,
    });
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("cancels without a write even when closing the window is unavailable", async () => {
    mount();
    await screen.findByText("Subscribe to Blog?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.close).toHaveBeenCalled();
    expect(screen.getByText("Subscription cancelled.")).toBeInTheDocument();
    expect(api.subscriptions.subscribe).not.toHaveBeenCalled();
  });

  it.each(["", "url=javascript%3Aalert(1)"])(
    "rejects invalid/missing input %s",
    (search) => {
      mount(search);
      expect(screen.getByText(/valid http\(s\) URL/)).toBeInTheDocument();
      expect(api.subscriptions.discover).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("offers original-source RSSFinder and retry when discovery fails", async () => {
    vi.mocked(api.subscriptions.discover).mockRejectedValueOnce({
      status: 422,
    });
    mount();
    const link = await screen.findByRole("link", { name: "Use RSSFinder.com" });
    expect(new URL(link.getAttribute("href") ?? "").searchParams.get("q")).toBe(
      source,
    );
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Subscribe to Blog?")).toBeInTheDocument();
  });

  it("retains choices on submission failure, prevents pending clicks, and retries", async () => {
    const user = userEvent.setup();
    let fail: (reason: unknown) => void = () => {};
    vi.mocked(api.subscriptions.subscribe).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    mount();
    await screen.findByText("Subscribe to Blog?");
    await user.type(screen.getByLabelText("Custom title (optional)"), "Mine");
    await user.selectOptions(screen.getByLabelText("Folder"), "7");
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(api.subscriptions.subscribe).toHaveBeenCalledTimes(1);
    fail({ status: 502 });
    expect(
      await screen.findByRole("link", { name: "Use RSSFinder.com" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Custom title (optional)")).toHaveValue(
      "Mine",
    );
    expect(screen.getByLabelText("Folder")).toHaveValue("7");
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(await screen.findByText("Subscribed!")).toBeInTheDocument();
  });

  it("reports duplicate without offering RSSFinder or updating settings", async () => {
    vi.mocked(api.subscriptions.subscribe).mockRejectedValue({ status: 409 });
    mount();
    await screen.findByText("Subscribe to Blog?");
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(
      await screen.findByText("Already subscribed to this feed"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(api.subscriptions.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Page title", "Page title"],
    ["", feed.feedUrl],
  ])("uses fallback name %s", async (pageTitle, expected) => {
    vi.mocked(api.subscriptions.discover).mockResolvedValue({
      feed: { ...feed, title: null },
    });
    mount(query(source, pageTitle));
    expect(
      await screen.findByText(`Subscribe to ${expected}?`),
    ).toBeInTheDocument();
  });

  it("keeps Subscribe disabled during folder errors and allows folder retry", async () => {
    vi.mocked(api.folders.list).mockRejectedValueOnce(new Error("offline"));
    mount();
    await screen.findByText("Could not load folders");
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry folders" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled(),
    );
  });

  it("ignores late results for a previous popup source", async () => {
    let finish: (result: { feed: typeof feed }) => void = () => {};
    vi.mocked(api.subscriptions.discover).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount();
    expect(screen.getByRole("status")).toHaveTextContent("Looking for a feed");
    view.rerender(
      <MantineProvider>
        <QueryClientProvider client={client}>
          <SubscribePage search={query("https://other.test/post", "Other")} />
        </QueryClientProvider>
      </MantineProvider>,
    );
    await screen.findByText("Subscribe to Blog?");
    finish({ feed: { ...feed, title: "Old result" } });
    await waitFor(() =>
      expect(
        screen.queryByText("Subscribe to Old result?"),
      ).not.toBeInTheDocument(),
    );
    expect(api.subscriptions.subscribe).not.toHaveBeenCalled();
  });
});
