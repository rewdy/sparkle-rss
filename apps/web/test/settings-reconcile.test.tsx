// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, useAtomValue } from "jotai";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySettings,
  appStore,
  colorSchemeAtom,
  themeIdAtom,
} from "../src/lib/ui-state";

function Probe(): ReactElement {
  const themeId = useAtomValue(themeIdAtom);
  const scheme = useAtomValue(colorSchemeAtom);
  return <span data-testid="probe">{`${themeId}/${scheme}`}</span>;
}

afterEach(() => {
  cleanup();
  appStore.set(themeIdAtom, "blue");
  appStore.set(colorSchemeAtom, "dark");
});

// Regression: `<JotaiProvider>` without a `store` prop renders from a private
// store, so `applySettings` wrote to a store nothing was subscribed to and
// server settings never reached the UI.
describe("server settings reconciliation", () => {
  it("reaches components rendered inside the app store provider", async () => {
    render(
      <JotaiProvider store={appStore}>
        <Probe />
      </JotaiProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("blue/dark");

    applySettings({ themeId: "persimmon" });

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("persimmon/dark"),
    );
  });

  it("leaves the device-local color scheme alone", async () => {
    render(
      <JotaiProvider store={appStore}>
        <Probe />
      </JotaiProvider>,
    );

    applySettings({ colorScheme: "light" });

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("blue/dark"),
    );
  });
});
