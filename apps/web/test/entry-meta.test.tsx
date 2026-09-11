// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EntryMeta } from "../src/components/EntryMeta";

function renderMeta(props: Parameters<typeof EntryMeta>[0]): void {
  render(
    <MantineProvider>
      <EntryMeta {...props} />
    </MantineProvider>,
  );
}

afterEach(cleanup);

describe("EntryMeta", () => {
  it("renders icon, site, author, and date in order", () => {
    renderMeta({
      iconUrl: "https://example.com/icon.png",
      site: "Site",
      author: "Ada",
      date: "Aug 26",
    });
    expect(screen.getByText("Site • Ada • Aug 26")).toBeInTheDocument();
    expect(
      document.querySelector('img[src="https://example.com/icon.png"]'),
    ).not.toBeNull();
  });

  it("omits the date when not provided", () => {
    renderMeta({ site: "Site", author: "Ada" });
    expect(screen.getByText("Site • Ada")).toBeInTheDocument();
  });

  it("falls back to an RSS glyph when there is no icon", () => {
    renderMeta({ site: "Site" });
    expect(screen.getByText("Site")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
