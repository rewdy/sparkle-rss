import type { MantineTheme } from "@mantine/core";
import { createTheme, DEFAULT_THEME, mergeMantineTheme } from "@mantine/core";

export const fonts = {
  mono: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '"DM Sans", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
};

const neutrals = [
  "#fafafa",
  "#f1f1f2",
  "#e0e0e3",
  "#c4c4c9",
  "#9a9aa2",
  "#55555c",
  "#33333a",
  "#222228",
  "#17171b",
  "#111114",
] as const;

export type ThemeId = "scarlet" | "blue" | "steel" | "magenta" | "purple";

// Mantine color ramps are 10-tuples; keeping this fixed makes swaps type-safe.
export type AccentShades = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export interface ThemeDef {
  id: ThemeId;
  label: string;
  accent: AccentShades;
  // Future style settings (e.g. fonts) extend ThemeDef and are merged
  // in buildTheme when present, so consumers never change shape.
}

const themes: Record<ThemeId, ThemeDef> = {
  blue: {
    id: "blue",
    label: "blue",
    accent: [
      "#eef6ff",
      "#d9ebff",
      "#b3d5ff",
      "#8cbfff",
      "#6aa9fa",
      "#4f93f0",
      "#3b86e9",
      "#2f6ecc",
      "#265aac",
      "#1d4587",
    ],
  },
  scarlet: {
    id: "scarlet",
    label: "scarlet",
    accent: [
      "#fdf2f2",
      "#f8dddd",
      "#efb8b8",
      "#e48d8d",
      "#d86262",
      "#c94a4d",
      "#a83c3f",
      "#8f3336",
      "#6f272a",
      "#531c1f",
    ],
  },
  steel: {
    id: "steel",
    label: "steel",
    accent: [
      "#eef2f5",
      "#dbe5ea",
      "#b7ccd6",
      "#90aeba",
      "#6d90a2",
      "#587a8d",
      "#4a6d80",
      "#3d5c6c",
      "#2f4856",
      "#20343f",
    ],
  },
  magenta: {
    id: "magenta",
    label: "magenta",
    accent: [
      "#fdf1f7",
      "#f9dcec",
      "#f0b7d6",
      "#e68dbe",
      "#dd67a6",
      "#d04a93",
      "#c23a84",
      "#a52f6f",
      "#7f2456",
      "#611a42",
    ],
  },
  purple: {
    id: "purple",
    label: "purple",
    accent: [
      "#f8f1fb",
      "#eadcf4",
      "#d3b9e5",
      "#b690d8",
      "#9870c0",
      "#8a5bb0",
      "#7e4a9f",
      "#683d84",
      "#4f2e66",
      "#37204a",
    ],
  },
};

export const THEME_DEFS: Record<ThemeId, ThemeDef> = themes;

export function buildTheme(def: ThemeDef): MantineTheme {
  return mergeMantineTheme(
    DEFAULT_THEME,
    createTheme({
      colors: {
        neutrals: [...neutrals],
        accent: [...def.accent],
      },
      primaryColor: "accent",
      primaryShade: 6,
      fontFamily: fonts.mono,
      fontFamilyMonospace: fonts.mono,
      headings: {
        fontFamily: fonts.sans,
        fontWeight: "700",
      },
      defaultRadius: "xs",
      radius: {
        xs: "2px",
        sm: "3px",
        md: "4px",
      },
    }),
  );
}

export const THEMES: Record<ThemeId, MantineTheme> = Object.fromEntries(
  Object.values(themes).map((def) => [def.id, buildTheme(def)]),
) as Record<ThemeId, MantineTheme>;

export const DEFAULT_THEME_ID: ThemeId = "blue";
