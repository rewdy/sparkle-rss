// @vitest-environment jsdom
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("presentation preference", () => {
  it.each(["list", "cards", "feed", "swipe", "invalid", null])(
    "initializes %s on reload",
    async (value) => {
      localStorage.setItem(
        "sparkle.ui",
        JSON.stringify({ storyPresentation: value }),
      );
      vi.resetModules();
      const { storyPresentationAtom } = await import("../src/lib/ui-state");
      expect(createStore().get(storyPresentationAtom)).toBe(
        value === "cards" || value === "swipe" ? value : "list",
      );
    },
  );

  it("migrates Feed while preserving unrelated local settings", async () => {
    localStorage.setItem(
      "sparkle.ui",
      JSON.stringify({
        storyPresentation: "feed",
        themeId: "purple",
        sidebarOpen: false,
      }),
    );
    vi.resetModules();
    const { storyPresentationAtom, isStoryPresentation } = await import(
      "../src/lib/ui-state"
    );
    expect(createStore().get(storyPresentationAtom)).toBe("list");
    expect(JSON.parse(localStorage.getItem("sparkle.ui") ?? "{}")).toEqual({
      storyPresentation: "list",
      themeId: "purple",
      sidebarOpen: false,
    });
    expect(isStoryPresentation("feed")).toBe(false);
    expect(isStoryPresentation("cards")).toBe(true);
  });

  it("falls back safely when storage is unavailable", async () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    vi.resetModules();
    const { storyPresentationAtom } = await import("../src/lib/ui-state");
    expect(createStore().get(storyPresentationAtom)).toBe("list");
    get.mockRestore();
  });

  it("persists locally and ignores account overrides", async () => {
    const { storyPresentationAtom, applySettings } = await import(
      "../src/lib/ui-state"
    );
    const { getDefaultStore } = await import("jotai");
    const store = getDefaultStore();
    store.set(storyPresentationAtom, "cards");
    applySettings({ storyPresentation: "swipe" });
    expect(store.get(storyPresentationAtom)).toBe("cards");
    expect(
      JSON.parse(localStorage.getItem("sparkle.ui") ?? "{}").storyPresentation,
    ).toBe("cards");
  });
});
