import { beforeEach, describe, expect, it } from "vitest";
import {
  applySettings,
  appStore,
  colorSchemeAtom,
  markReadOnOpenAtom,
  sidebarOpenAtom,
  sidebarUnreadOnlyAtom,
  themeIdAtom,
} from "../src/lib/ui-state";
import { THEME_DEFS, type ThemeId } from "../src/themes";

// Each test starts from the app's single store (atoms seed from localStorage
// at module load, which Node lacks — they fall back to defaults).
describe("applySettings", () => {
  beforeEach(() => {
    const store = appStore;
    store.set(colorSchemeAtom, "dark");
    store.set(themeIdAtom, "blue");
    store.set(markReadOnOpenAtom, true);
    store.set(sidebarOpenAtom, true);
    store.set(sidebarUnreadOnlyAtom, false);
  });

  it("applies recognized server settings over the current values", () => {
    applySettings({
      themeId: "steel",
      markReadOnOpen: false,
    });
    const store = appStore;
    expect(store.get(themeIdAtom)).toBe("steel");
    expect(store.get(markReadOnOpenAtom)).toBe(false);
  });

  it("keeps the device-local color scheme out of server settings", () => {
    applySettings({ colorScheme: "system", themeId: "purple" });
    const store = appStore;
    expect(store.get(colorSchemeAtom)).toBe("dark");
    expect(store.get(themeIdAtom)).toBe("purple");
  });

  it("applies every preset the catalog offers", () => {
    for (const id of Object.keys(THEME_DEFS) as ThemeId[]) {
      applySettings({ themeId: id });
      expect(appStore.get(themeIdAtom)).toBe(id);
    }
  });

  it("ignores unknown keys and invalid values", () => {
    applySettings({
      nonsense: "x",
      colorScheme: "neon",
      themeId: 42,
      markReadOnOpen: "yes",
    });
    const store = appStore;
    expect(store.get(colorSchemeAtom)).toBe("dark");
    expect(store.get(themeIdAtom)).toBe("blue");
    expect(store.get(markReadOnOpenAtom)).toBe(true);
    // untouched key stays put
    expect(store.get(sidebarOpenAtom)).toBe(true);
  });

  it("is a no-op when values are unchanged", () => {
    applySettings({ colorScheme: "dark", themeId: "blue" });
    const store = appStore;
    expect(store.get(colorSchemeAtom)).toBe("dark");
  });

  it("applies the sidebar unread-only preference", () => {
    applySettings({ sidebarUnreadOnly: true });
    expect(appStore.get(sidebarUnreadOnlyAtom)).toBe(true);
  });

  it("ignores a non-boolean sidebar unread-only value", () => {
    applySettings({ sidebarUnreadOnly: "yes" });
    expect(appStore.get(sidebarUnreadOnlyAtom)).toBe(false);
  });
});
