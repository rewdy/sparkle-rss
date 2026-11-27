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
      const { streamPresentationAtom } = await import("../src/lib/ui-state");
      expect(createStore().get(streamPresentationAtom)).toBe(
        value === "cards" ? value : "list",
      );
    },
  );

  it.each(["feed", "swipe"])(
    "migrates %s while preserving unrelated local settings",
    async (legacy) => {
      localStorage.setItem(
        "sparkle.ui",
        JSON.stringify({
          storyPresentation: legacy,
          themeId: "purple",
          sidebarOpen: false,
        }),
      );
      vi.resetModules();
      const { streamPresentationAtom, isStreamPresentation } = await import(
        "../src/lib/ui-state"
      );
      expect(createStore().get(streamPresentationAtom)).toBe("list");
      expect(JSON.parse(localStorage.getItem("sparkle.ui") ?? "{}")).toEqual({
        storyPresentation: "list",
        themeId: "purple",
        sidebarOpen: false,
      });
      expect(isStreamPresentation(legacy)).toBe(false);
      expect(isStreamPresentation("cards")).toBe(true);
    },
  );

  it("falls back safely when storage is unavailable", async () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    vi.resetModules();
    const { streamPresentationAtom } = await import("../src/lib/ui-state");
    expect(createStore().get(streamPresentationAtom)).toBe("list");
    get.mockRestore();
  });

  it("persists locally and ignores account overrides", async () => {
    const { streamPresentationAtom, applySettings } = await import(
      "../src/lib/ui-state"
    );
    const { getDefaultStore } = await import("jotai");
    const store = getDefaultStore();
    store.set(streamPresentationAtom, "cards");
    applySettings({ storyPresentation: "swipe" });
    expect(store.get(streamPresentationAtom)).toBe("cards");
    expect(
      JSON.parse(localStorage.getItem("sparkle.ui") ?? "{}").storyPresentation,
    ).toBe("cards");
  });

  it("restores the accent preset cached for first paint", async () => {
    localStorage.setItem(
      "sparkle.ui",
      JSON.stringify({ themeId: "persimmon" }),
    );
    vi.resetModules();
    const { themeIdAtom } = await import("../src/lib/ui-state");
    expect(createStore().get(themeIdAtom)).toBe("persimmon");
  });
});
