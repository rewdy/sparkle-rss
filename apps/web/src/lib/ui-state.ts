import { atom, createStore, useAtom } from "jotai";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "../themes";
import { localDateKey } from "./keys";

export type ColorSchemePref = "light" | "dark" | "system";
export type StoryPresentation = "list" | "cards" | "swipe";

export function isStoryPresentation(
  value: unknown,
): value is StoryPresentation {
  return value === "list" || value === "cards" || value === "swipe";
}

export function loadLocalUi(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem("sparkle.ui") ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function isColorScheme(v: unknown): v is ColorSchemePref {
  return v === "light" || v === "dark" || v === "system";
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((item): item is string => typeof item === "string")
    : [];
}

// Atoms initialize from localStorage at module load (synchronous, pre-mount)
// so the first paint already uses saved preferences.
/**
 * The one store the app runs on: `App.tsx` passes it to `<JotaiProvider store>`
 * and everything outside React (imperative setters, `applySettings`) writes to
 * the same instance. A `<Provider>` without a `store` prop creates a private
 * store instead, which silently detaches `getDefaultStore()` writes from the
 * components that render the atoms.
 */
export const appStore = createStore();

const local = loadLocalUi();
if (local.storyPresentation === "feed") {
  local.storyPresentation = "list";
  persistUiPatch({ storyPresentation: "list" });
}
const storyPresentationBaseAtom = atom<StoryPresentation>(
  isStoryPresentation(local.storyPresentation)
    ? local.storyPresentation
    : "list",
);
export const storyPresentationAtom = atom(
  (get) => get(storyPresentationBaseAtom),
  (_get, set, next: StoryPresentation) => {
    set(storyPresentationBaseAtom, next);
    persistUiPatch({ storyPresentation: next });
  },
);

const colorSchemeBaseAtom = atom<ColorSchemePref>(
  isColorScheme(local.colorScheme) ? local.colorScheme : "dark",
);
export const colorSchemeAtom = atom(
  (get) => get(colorSchemeBaseAtom),
  (_get, set, next: ColorSchemePref) => {
    set(colorSchemeBaseAtom, next);
    persistUiPatch({ colorScheme: next });
  },
);

// The accent preset belongs to the account: `user_settings.data.themeId` is the
// source of truth so it follows the user across devices. The localStorage copy
// is only a first-paint cache (avoids a flash of the default accent) that
// `applySettings` overwrites as soon as the settings fetch lands.
const themeIdBaseAtom = atom<ThemeId>(
  isThemeId(local.themeId) ? local.themeId : DEFAULT_THEME_ID,
);
export const themeIdAtom = atom(
  (get) => get(themeIdBaseAtom),
  (_get, set, next: ThemeId) => {
    set(themeIdBaseAtom, next);
    persistUiPatch({ themeId: next });
  },
);

const sidebarOpenBaseAtom = atom<boolean>(asBool(local.sidebarOpen, true));
export const sidebarOpenAtom = atom(
  (get) => get(sidebarOpenBaseAtom),
  (_get, set, next: boolean) => {
    set(sidebarOpenBaseAtom, next);
    persistUiPatch({ sidebarOpen: next });
  },
);

const markReadOnOpenBaseAtom = atom<boolean>(
  asBool(local.markReadOnOpen, true),
);
export const markReadOnOpenAtom = atom(
  (get) => get(markReadOnOpenBaseAtom),
  (_get, set, next: boolean) => {
    set(markReadOnOpenBaseAtom, next);
    persistUiPatch({ markReadOnOpen: next });
  },
);

const sidebarUnreadOnlyBaseAtom = atom<boolean>(
  asBool(local.sidebarUnreadOnly, false),
);
export const sidebarUnreadOnlyAtom = atom(
  (get) => get(sidebarUnreadOnlyBaseAtom),
  (_get, set, next: boolean) => {
    set(sidebarUnreadOnlyBaseAtom, next);
    persistUiPatch({ sidebarUnreadOnly: next });
  },
);

// Folder ids the user has collapsed in the sidebar. Absence means expanded.
const collapsedFoldersBaseAtom = atom<string[]>(
  asStringArray(local.collapsedFolders),
);
export const collapsedFoldersAtom = atom(
  (get) => get(collapsedFoldersBaseAtom),
  (_get, set, next: string[]) => {
    set(collapsedFoldersBaseAtom, next);
    persistUiPatch({ collapsedFolders: next });
  },
);

/**
 * Ticks to the next local calendar date at midnight so stream views keyed on
 * "today" roll over and refetch without requiring a navigation.
 */
export const todayRolloverAtom = atom<string>(localDateKey());

export const shortcutsOpenAtom = atom(false);

/**
 * Apply server-owned settings after the first settings fetch: sets an atom only
 * for keys present with a valid value and different from the current one.
 * Mutating `atom.init` post-mount is a no-op in jotai, so values are SET on
 * `appStore` — the store the provider renders from.
 */
export function applySettings(data: Record<string, unknown>): void {
  const store = appStore;
  // `colorScheme` is deliberately absent: light/dark is per device, so a server
  // value must never overwrite the local choice (topbar toggles are local-only).
  if (isThemeId(data.themeId) && data.themeId !== store.get(themeIdBaseAtom)) {
    store.set(themeIdAtom, data.themeId);
  }
  if (
    typeof data.markReadOnOpen === "boolean" &&
    data.markReadOnOpen !== store.get(markReadOnOpenBaseAtom)
  ) {
    store.set(markReadOnOpenAtom, data.markReadOnOpen);
  }
  if (
    typeof data.sidebarOpen === "boolean" &&
    data.sidebarOpen !== store.get(sidebarOpenBaseAtom)
  ) {
    store.set(sidebarOpenAtom, data.sidebarOpen);
  }
  if (
    typeof data.sidebarUnreadOnly === "boolean" &&
    data.sidebarUnreadOnly !== store.get(sidebarUnreadOnlyBaseAtom)
  ) {
    store.set(sidebarUnreadOnlyAtom, data.sidebarUnreadOnly);
  }
}

export function persistUiPatch(patch: Record<string, unknown>): void {
  try {
    const current = loadLocalUi();
    localStorage.setItem(
      "sparkle.ui",
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function useColorSchemeValue(): [
  ColorSchemePref,
  (n: ColorSchemePref) => void,
] {
  return useAtom(colorSchemeAtom);
}

export function useThemeValue(): [ThemeId, (n: ThemeId) => void] {
  return useAtom(themeIdAtom);
}
