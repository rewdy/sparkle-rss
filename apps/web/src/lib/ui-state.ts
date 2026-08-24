import { atom, useAtom } from 'jotai';

export type Density = 'compact' | 'cozy';
export type ColorSchemePref = 'light' | 'dark';

const colorSchemeBaseAtom = atom<ColorSchemePref>('dark');
export const colorSchemeAtom = atom(
  (get) => get(colorSchemeBaseAtom),
  (_get, set, next: ColorSchemePref) => {
    set(colorSchemeBaseAtom, next);
    persistUiPatch({ colorScheme: next });
  },
);

export const sidebarOpenBaseAtom = atom(true);
export const sidebarOpenAtom = atom(
  (get) => get(sidebarOpenBaseAtom),
  (_get, set, next: boolean) => {
    set(sidebarOpenBaseAtom, next);
    persistUiPatch({ sidebarOpen: next });
  },
);

const densityBaseAtom = atom<Density>('cozy');
export const densityAtom = atom(
  (get) => get(densityBaseAtom),
  (_get, set, next: Density) => {
    set(densityBaseAtom, next);
    persistUiPatch({ density: next });
  },
);

const markReadOnOpenBaseAtom = atom(true);
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

export const activeEntryIdAtom = atom<string | null>(null);
export const shortcutsOpenAtom = atom(false);

/** Hydrate UI atoms from a merged settings object (localStorage + server). */
export function hydrateFromSettings(data: Record<string, unknown>): void {
  if (data.colorScheme === 'light' || data.colorScheme === 'dark') {
    colorSchemeBaseAtom.init = data.colorScheme;
  }
  if (data.density === 'compact' || data.density === 'cozy') {
    densityBaseAtom.init = data.density;
  }
  if (typeof data.markReadOnOpen === 'boolean') {
    markReadOnOpenBaseAtom.init = data.markReadOnOpen;
  }
  if (typeof data.sidebarOpen === 'boolean') {
    sidebarOpenBaseAtom.init = data.sidebarOpen;
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

export function loadLocalUi(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem('sparkle.ui') ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function useColorSchemeValue(): [ColorSchemePref, (n: ColorSchemePref) => void] {
  return useAtom(colorSchemeAtom);
}
