import { atom, getDefaultStore, useAtom } from 'jotai';
import { DEFAULT_THEME_ID, type ThemeId } from '../themes';
import { localDateKey } from './keys';

export type ColorSchemePref = 'light' | 'dark' | 'system';

export function loadLocalUi(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem('sparkle.ui') ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isColorScheme(v: unknown): v is ColorSchemePref {
  return v === 'light' || v === 'dark' || v === 'system';
}

function isThemeId(v: unknown): v is ThemeId {
  return v === 'scarlet' || v === 'blue' || v === 'steel' || v === 'magenta' || v === 'purple';
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

// Atoms initialize from localStorage at module load (synchronous, pre-mount)
// so the first paint already uses saved preferences.
const local = loadLocalUi();

const colorSchemeBaseAtom = atom<ColorSchemePref>(
  isColorScheme(local.colorScheme) ? local.colorScheme : 'dark',
);
export const colorSchemeAtom = atom(
  (get) => get(colorSchemeBaseAtom),
  (_get, set, next: ColorSchemePref) => {
    set(colorSchemeBaseAtom, next);
    persistUiPatch({ colorScheme: next });
  },
);

const themeIdBaseAtom = atom<ThemeId>(isThemeId(local.themeId) ? local.themeId : DEFAULT_THEME_ID);
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

const markReadOnOpenBaseAtom = atom<boolean>(asBool(local.markReadOnOpen, true));
export const markReadOnOpenAtom = atom(
  (get) => get(markReadOnOpenBaseAtom),
  (_get, set, next: boolean) => {
    set(markReadOnOpenBaseAtom, next);
    persistUiPatch({ markReadOnOpen: next });
  },
);

/**
 * Ticks to the next local calendar date at midnight so stream views keyed on
 * "today" roll over and refetch without requiring a navigation.
 */
export const todayRolloverAtom = atom<string>(localDateKey());

export const shortcutsOpenAtom = atom(false);

/**
 * Apply server settings (merged over local) after the first settings fetch.
 * Sets an atom only for keys present with a valid value and different from
 * the current one. Mutating `atom.init` post-mount is a no-op in jotai, so
 * values must be SET through the default store (JotaiProvider uses it).
 */
export function applySettings(data: Record<string, unknown>): void {
  const store = getDefaultStore();
  if (isColorScheme(data.colorScheme) && data.colorScheme !== store.get(colorSchemeBaseAtom)) {
    store.set(colorSchemeAtom, data.colorScheme);
  }
  if (isThemeId(data.themeId) && data.themeId !== store.get(themeIdBaseAtom)) {
    store.set(themeIdAtom, data.themeId);
  }
  if (
    typeof data.markReadOnOpen === 'boolean' &&
    data.markReadOnOpen !== store.get(markReadOnOpenBaseAtom)
  ) {
    store.set(markReadOnOpenAtom, data.markReadOnOpen);
  }
  if (
    typeof data.sidebarOpen === 'boolean' &&
    data.sidebarOpen !== store.get(sidebarOpenBaseAtom)
  ) {
    store.set(sidebarOpenAtom, data.sidebarOpen);
  }
}

export function persistUiPatch(patch: Record<string, unknown>): void {
  try {
    const current = loadLocalUi();
    localStorage.setItem('sparkle.ui', JSON.stringify({ ...current, ...patch }));
  } catch {
    /* storage unavailable */
  }
}

export function useColorSchemeValue(): [ColorSchemePref, (n: ColorSchemePref) => void] {
  return useAtom(colorSchemeAtom);
}

export function useThemeValue(): [ThemeId, (n: ThemeId) => void] {
  return useAtom(themeIdAtom);
}
