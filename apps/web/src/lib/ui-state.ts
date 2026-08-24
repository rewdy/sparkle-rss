import { atom, getDefaultStore, useAtom } from 'jotai';

export type Density = 'compact' | 'cozy';
export type ColorSchemePref = 'light' | 'dark';

export function loadLocalUi(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem('sparkle.ui') ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isColorScheme(v: unknown): v is ColorSchemePref {
  return v === 'light' || v === 'dark';
}

function isDensity(v: unknown): v is Density {
  return v === 'compact' || v === 'cozy';
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

const sidebarOpenBaseAtom = atom<boolean>(asBool(local.sidebarOpen, true));
export const sidebarOpenAtom = atom(
  (get) => get(sidebarOpenBaseAtom),
  (_get, set, next: boolean) => {
    set(sidebarOpenBaseAtom, next);
    persistUiPatch({ sidebarOpen: next });
  },
);

const densityBaseAtom = atom<Density>(isDensity(local.density) ? local.density : 'cozy');
export const densityAtom = atom(
  (get) => get(densityBaseAtom),
  (_get, set, next: Density) => {
    set(densityBaseAtom, next);
    persistUiPatch({ density: next });
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

const filterBaseAtom = atom<'all' | 'unread'>('all');
export const filterAtom = atom(
  (get) => get(filterBaseAtom),
  (_get, set, next: 'all' | 'unread') => {
    set(filterBaseAtom, next);
  },
);

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
  if (isDensity(data.density) && data.density !== store.get(densityBaseAtom)) {
    store.set(densityAtom, data.density);
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
