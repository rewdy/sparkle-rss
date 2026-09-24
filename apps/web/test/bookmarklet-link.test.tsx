// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BookmarkletLink } from "../src/components/BookmarkletLink";

function renderLink(showCode = false): void {
  render(
    <MantineProvider>
      <BookmarkletLink showCode={showCode} />
    </MantineProvider>,
  );
}

afterEach(cleanup);

describe("BookmarkletLink", () => {
  it("writes the javascript: url onto the anchor node", async () => {
    renderLink();
    const link = await screen.findByRole("link", { name: "Read later" });
    // React substitutes a throw-stub for a `javascript:` href, so the real URL
    // is written after mount; dragging reads the DOM attribute.
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("javascript:");
    expect(href).toContain("/read-later/new?");
  });

  it("hides the raw snippet by default", () => {
    renderLink();
    expect(screen.queryByText(/window\.open/)).not.toBeInTheDocument();
  });

  it("shows the copyable snippet when asked", () => {
    renderLink(true);
    expect(screen.getByText(/window\.open/)).toBeInTheDocument();
  });
});
