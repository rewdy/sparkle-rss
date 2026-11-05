import { alpha } from "@mantine/core";
import { describe, expect, it } from "vitest";
import {
  cssVariablesResolver,
  DEFAULT_THEME_ID,
  THEME_DEFS,
  type ThemeDef,
  type ThemeId,
} from "../src/themes";

const DARK_BODY = "#17171b";

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  expect(match, `not a hex color: ${hex}`).toBeTruthy();
  const digits = match?.[1] ?? "000000";
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (l1 + 0.05) / (l2 + 0.05);
}

function blendOver(
  color: [number, number, number],
  alphaValue: number,
  background: [number, number, number],
): [number, number, number] {
  return color.map((channel, i) =>
    Math.round(channel * alphaValue + background[i] * (1 - alphaValue)),
  ) as [number, number, number];
}

const PRESETS: Array<[ThemeId, ThemeDef]> = Object.entries(THEME_DEFS) as Array<
  [ThemeId, ThemeDef]
>;

describe("accent themes", () => {
  it("offers the six presets with complete ten-shade ramps", () => {
    expect(Object.keys(THEME_DEFS).sort()).toEqual(
      ["blue", "magenta", "persimmon", "purple", "scarlet", "steel"].sort(),
    );
    for (const def of Object.values(THEME_DEFS)) {
      expect(def.accent).toHaveLength(10);
      for (const shade of def.accent) expect(shade).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(DEFAULT_THEME_ID).toBe("blue");
  });

  it.each(PRESETS)(
    "%s emphasis shade clears 4.5:1 on the dark page",
    (_id, def) => {
      expect(
        contrast(hexToRgb(def.accent[4]), hexToRgb(DARK_BODY)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(PRESETS)("%s filled shade clears 3:1 against white", (_id, def) => {
    expect(
      contrast(hexToRgb(def.accent[6]), hexToRgb("#ffffff")),
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(PRESETS)(
    "%s selected tint reads as a visible tint on the dark page",
    (_id, def) => {
      const tint = blendOver(
        hexToRgb(def.accent[5]),
        0.22,
        hexToRgb(DARK_BODY),
      );
      const ratio = contrast(tint, hexToRgb(DARK_BODY));
      expect(ratio).toBeGreaterThanOrEqual(1.2);
      expect(relativeLuminance(tint)).toBeGreaterThan(
        relativeLuminance(hexToRgb(DARK_BODY)),
      );
    },
  );

  it("resolves the semantic accent tokens per scheme", () => {
    const def = THEME_DEFS.blue;
    const theme = {
      colors: {
        accent: [...def.accent],
        dark: ["", "", "", "", "", "", "", ""],
      },
    };
    const vars = cssVariablesResolver(theme as never);
    expect(vars.light["--sparkle-accent-tint"]).toBe(def.accent[0]);
    expect(vars.light["--sparkle-accent-tint-strong"]).toBe(def.accent[1]);
    expect(vars.light["--sparkle-accent-strong"]).toBe(def.accent[7]);
    expect(vars.dark["--mantine-color-accent-filled"]).toBe(def.accent[6]);
    expect(vars.dark["--mantine-color-accent-filled-hover"]).toBe(
      def.accent[7],
    );
    expect(vars.dark["--sparkle-accent-strong"]).toBe(def.accent[4]);
    expect(vars.dark["--sparkle-accent-tint-strong"]).toBe(
      alpha(def.accent[5], 0.22),
    );
    expect(vars.dark["--sparkle-accent-tint"]).toBe(alpha(def.accent[5], 0.14));
  });
});
