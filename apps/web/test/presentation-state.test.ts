// @vitest-environment jsdom
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("presentation preference", () => {
  it.each(["list", "feed", "swipe", "invalid", null])(
    "initializes %s on reload",
    async (value) => {
      localStorage.setItem(
        "sparkle.ui",
        JSON.stringify({ storyPresentation: value }),
      );
      vi.resetModules();
      const { storyPresentationAtom } = await import("../src/lib/ui-state");
      expect(createStore().get(storyPresentationAtom)).toBe(
        value === "feed" || value === "swipe" ? value : "list",
      );
    },
  );

  it("persists locally and ignores account overrides", async () => {
    const { storyPresentationAtom, applySettings } = await import(
      "../src/lib/ui-state"
    );
    const { getDefaultStore } = await import("jotai");
    const store = getDefaultStore();
    store.set(storyPresentationAtom, "feed");
    applySettings({ storyPresentation: "swipe" });
    expect(store.get(storyPresentationAtom)).toBe("feed");
    expect(
      JSON.parse(localStorage.getItem("sparkle.ui") ?? "{}").storyPresentation,
    ).toBe("feed");
  });
});
