// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedMenu } from "../src/components/ManageMenus";
import { api } from "../src/lib/api";
import type { Subscription } from "../src/lib/types";

vi.mock("../src/lib/api", () => ({
  api: { subscriptions: { edit: vi.fn() } },
}));
const sub: Subscription = {
  feedId: "1",
  fetchFullArticles: true,
  url: "https://example.com/feed",
  siteUrl: "",
  iconUrl: "",
  customTitle: null,
  feedTitle: "Feed",
  displayTitle: "Feed",
  categoryId: null,
  categoryName: null,
  entryCount: 1,
  newestEntryAtMs: null,
};
const navigate = vi.fn((event: { preventDefault(): void }) =>
  event.preventDefault(),
);
let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["subscriptions"], { subscriptions: [sub] });
  vi.resetAllMocks();
});
afterEach(cleanup);
function mount(subscription = sub) {
  return render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <a href="/feed/1" onClick={navigate}>
          <FeedMenu sub={subscription} folders={[]} />
        </a>
      </QueryClientProvider>
    </MantineProvider>,
  );
}
async function edit() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "manage feed Feed" }));
  await user.click(await screen.findByRole("menuitem", { name: "edit" }));
  await screen.findByRole("dialog");
  return user;
}
it("saves a preference-only edit, patches body caches and preserves article flags", async () => {
  const content = {
    contentHtml: "fetched",
    originalContentHtml: "original",
    fullContent: {
      fetchEnabled: true,
      automaticFetchEligible: true,
      status: "ready",
    },
  };
  const entry = {
    id: "2",
    feedId: "1",
    ...content,
    isRead: true,
    isStarred: true,
  };
  qc.setQueryData(["entries", "all"], { pages: [{ items: [entry] }] });
  qc.setQueryData(["entry", "2"], { entry });
  qc.setQueryData(["saved"], {
    pages: [{ items: [{ kind: "article", entry }] }],
  });
  qc.setQueryData(["article-content", "2"], content);
  vi.mocked(api.subscriptions.edit).mockResolvedValue({
    subscription: { ...sub, fetchFullArticles: false },
  });
  const view = mount();
  const user = await edit();
  expect(
    screen.getByRole("switch", { name: /^Fetch full articles/ }),
  ).toBeChecked();
  await user.click(
    screen.getByRole("switch", { name: /^Fetch full articles/ }),
  );
  await user.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() =>
    expect(api.subscriptions.edit).toHaveBeenCalledWith("1", {
      title: "Feed",
      fetchFullArticles: false,
    }),
  );
  await waitFor(() =>
    expect(qc.getQueryData(["article-content", "2"])).toMatchObject({
      contentHtml: "original",
      fullContent: { fetchEnabled: false },
    }),
  );
  expect(qc.getQueryData(["entry", "2"])).toMatchObject({
    entry: { contentHtml: "original", isRead: true, isStarred: true },
  });
  expect(qc.getQueryData(["saved"])).toMatchObject({
    pages: [{ items: [{ entry: { contentHtml: "original" } }] }],
  });
  expect(navigate).not.toHaveBeenCalled();
  view.unmount();
  mount({ ...sub, fetchFullArticles: false });
  await edit();
  expect(
    screen.getByRole("switch", { name: /^Fetch full articles/ }),
  ).not.toBeChecked();
});
it("keeps drafts and shows feedback after a failed save", async () => {
  vi.mocked(api.subscriptions.edit).mockRejectedValue(new Error("Save failed"));
  mount();
  const user = await edit();
  await user.click(
    screen.getByRole("switch", { name: /^Fetch full articles/ }),
  );
  await user.click(screen.getByRole("button", { name: "save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(
    screen.getByRole("switch", { name: /^Fetch full articles/ }),
  ).not.toBeChecked();
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("prevents edits during a pending save", async () => {
  vi.mocked(api.subscriptions.edit).mockImplementation(
    () => new Promise(() => {}),
  );
  mount();
  const user = await edit();
  await user.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: /^Fetch full articles/ }),
    ).toBeDisabled(),
  );
});
