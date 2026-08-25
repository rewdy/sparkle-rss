import { createTheme, DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';

export const fonts = {
  mono: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '"DM Sans", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
};

const neutrals = [
  '#fafafa',
  '#f1f1f2',
  '#e0e0e3',
  '#c4c4c9',
  '#9a9aa2',
  '#55555c',
  '#33333a',
  '#222228',
  '#17171b',
  '#111114',
] as const;

const accent = [
  '#f2f4fb',
  '#e2e7f5',
  '#b9c4e8',
  '#8d9dd9',
  '#6679c4',
  '#4a5cab',
  '#314394',
  '#29397c',
  '#212e64',
  '#19234c',
] as const;

export const theme = mergeMantineTheme(
  DEFAULT_THEME,
  createTheme({
    colors: {
      neutrals: [...neutrals],
      accent: [...accent],
    },
    primaryColor: 'accent',
    primaryShade: 6,
    fontFamily: fonts.mono,
    fontFamilyMonospace: fonts.mono,
    headings: {
      fontFamily: fonts.sans,
      fontWeight: '700',
    },
    defaultRadius: 'xs',
    radius: {
      xs: '2px',
      sm: '3px',
      md: '4px',
    },
    components: {
      // Reading surface uses the sans stack for comfort; chrome stays mono.
      Text: {
        defaultProps: {},
      },
    },
  }),
);
