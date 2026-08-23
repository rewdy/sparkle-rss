import { atom, useAtom } from 'jotai';

export type ColorScheme = 'light' | 'dark';

const colorSchemeBaseAtom = atom<ColorScheme>('dark');

export const colorSchemeAtom = atom(
  (get) => get(colorSchemeBaseAtom),
  (_get, set, next: ColorScheme) => {
    set(colorSchemeBaseAtom, next);
  },
);

export function useColorScheme(): [ColorScheme, (next: ColorScheme) => void] {
  return useAtom(colorSchemeAtom);
}
