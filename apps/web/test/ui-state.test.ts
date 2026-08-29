import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applySettings,
  colorSchemeAtom,
  markReadOnOpenAtom,
  sidebarOpenAtom,
  themeIdAtom,
} from "../src/lib/ui-state";

// Each test starts from the shared default store (module-level atoms seed from
// whatever is in localStorage, which Node lacks — they fall back to defaults).
describe("applySettings", () => {
  beforeEach(() => {
    const store = getDefaultStore();
    store.set(colorSchemeAtom, "dark");
    store.set(themeIdAtom, "blue");
    store.set(markReadOnOpenAtom, true);
    store.set(sidebarOpenAtom, true);
  });

  it("applies recognized server settings over the current values", () => {
    applySettings({
      colorScheme: "system",
      themeId: "steel",
      markReadOnOpen: false,
    });
    const store = getDefaultStore();
    expect(store.get(colorSchemeAtom)).toBe("system");
    expect(store.get(themeIdAtom)).toBe("steel");
    expect(store.get(markReadOnOpenAtom)).toBe(false);
  });

  it("ignores unknown keys and invalid values", () => {
    applySettings({
      nonsense: "x",
      colorScheme: "neon",
      themeId: 42,
      markReadOnOpen: "yes",
    });
    const store = getDefaultStore();
    expect(store.get(colorSchemeAtom)).toBe("dark");
    expect(store.get(themeIdAtom)).toBe("blue");
    expect(store.get(markReadOnOpenAtom)).toBe(true);
    // untouched key stays put
    expect(store.get(sidebarOpenAtom)).toBe(true);
  });

  it("is a no-op when values are unchanged", () => {
    applySettings({ colorScheme: "dark", themeId: "blue" });
    const store = getDefaultStore();
    expect(store.get(colorSchemeAtom)).toBe("dark");
  });
});
