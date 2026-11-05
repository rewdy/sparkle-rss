# Design

## Context

See proposal.md — Why. Current state verified against `apps/web/src` and the installed
`@mantine/core` v9 sources:

- `apps/web/src/themes.ts` owns every color: a shared `neutrals` ramp, five accent
  ramps (`blue`, `scarlet`, `steel`, `magenta`, `purple`), `fonts.mono` /
  `fonts.sans`, `buildTheme`, and `cssVariablesResolver`. The theme sets
  `fontFamily: fonts.mono` app-wide, `headings.fontFamily: fonts.sans`, and
  `primaryShade: 6` (a scalar, so both schemes use shade 6).
- Mantine's own default is `primaryShade: { light: 6, dark: 8 }`. Mantine derives
  per-color variables from the scheme's primary shade: `--mantine-color-{c}-filled`,
  `-filled-hover`, `-light`, `-light-hover`, `-light-color`, `-outline`,
  `-outline-hover`. `NavLink` active backgrounds/labels, `Button variant="light"`,
  and `Badge variant="light"` all consume those variables.
- Measured against the dark page `#17171b`, shade 6 as emphasis text gives blue 4.91,
  scarlet 2.88, steel 3.23, magenta 3.60, purple 2.87. Shades 4 gives 7.38 / 4.97 /
  5.24 / 5.59 / 4.61 — all clear 4.5:1. This is the "screened" complaint: emphasis
  text and the 10%-alpha tints derived from a mid shade land muddy on dark.
- Hand-written accent usage in `apps/web/src/styles.css`:
  `.entry-row:hover` (dark `dark-6`), `.entry-row[data-active]` (dark
  `accent-9` background + `accent-6` inset bar), `.article-card[data-active]`,
  `.card-placeholder` (dark `accent-7` glyph), `.site-title:hover` (dark
  `accent-3`), `.reading-content pre` (token-based, unchanged).
- `apps/web/src/pages/Settings.tsx:83-110` renders one `ColorSwatch` per preset using
  `def.accent[6]`, with a selection ring in `accent-5`.
- Mantine type and spacing are rem-based (`calc(1rem * var(--mantine-scale))`,
  `rem()` for spacing/AppShell sizes); `.reading-content` hardcodes `16px`, and the
  mobile input rule hardcodes `16px !important` to stop iOS focus zoom.
- The sidebar (`apps/web/src/components/Sidebar.tsx`) inherits the mono body face.
  Mantine's `Text`/`NavLink` roots do not declare `font-family`, so a face set on the
  sidebar container cascades to labels and headings; the unread `Badge` sets
  `ff="monospace"` explicitly and is unaffected.

## Goals / Non-Goals

**Goals:**

- One scheme-aware accent contract, expressed through Mantine theme configuration, so
  components and hand-written CSS stop sampling raw ramp values for dark mode.
- A single root-scaling lever for wide viewports that keeps user text preferences.
- Sidebar face change that is one line to review and one line to revert.

**Non-Goals:**

- Rewriting the five existing accent ramps' hex values; the fix is which shades get
  sampled, not new palettes. If visual review still dislikes a specific ramp, its
  hexes are a follow-up edit.
- Changing neutral surfaces, the light scheme's selected/hover values, or any
  Google Reader / API surface.
- A user-facing setting for either the sidebar face or the large-screen scale.

## Decisions

1. **Root scale via a percentage `html` font-size at a wide-viewport media query.**
   Add to `styles.css`:
   `@media (min-width: 100em) { html { font-size: 112.5%; } }`.
   Everything rem-based (type, spacing, AppShell header/navbar sizes) grows together;
   `em` in media queries resolves against the initial font size, so breakpoints do not
   shift. Percentage (not `18px`) preserves a user who raised their browser default.
   Alternatives rejected: raising `theme.fontSizes`/`spacing` (misses rem layout
   values and duplicates every scale); setting `theme.scale` (a static theme value,
   cannot vary by viewport, and would also multiply padding/radius unpredictably);
   a JS media query writing a root style (reintroduces a hydration flash for no gain).
2. **Article body text becomes rem-based.** `.reading-content` switches `16px` to
   `1rem` so it inherits the scale; today it is pixel-identical. The iOS anti-zoom
   floor stays at `16px` because it is a fixed behavior, not a design scale.
3. **Scheme-aware primary shade plus a filled-button override.** `buildTheme` sets
   `primaryShade: { light: 6, dark: 4 }`. In dark mode that moves `-light-color`,
   `-light`, and `-outline` to shade 4 (contrast-safe for every preset) while light
   mode stays on shade 6. Because `-filled` also follows the scheme's primary shade,
   `cssVariablesResolver` overrides `--mantine-color-accent-filled` and
   `--mantine-color-accent-filled-hover` in the dark branch with shade 6/7 to keep
   primary buttons deep with white text.
   Alternatives rejected: a custom `variantColorResolver` (must re-implement the
   default for every other color, including destructive red, for one accent tweak);
   global `autoContrast` (would give destructive red buttons black labels);
   `primaryShade.dark = 8` (Mantine's default — makes dark buttons darker still and
   emphasis text unusable).
4. **Accent surfaces become semantic tokens emitted per scheme.** The resolver emits,
   for both schemes:
   - `--sparkle-accent-tint-strong` — selected surface: light `accent-1`, dark
     `alpha(accent-5, 0.22)` over the page.
   - `--sparkle-accent-tint` — hover surface: light `accent-0`, dark
     `alpha(accent-5, 0.14)`.
   - `--sparkle-accent-strong` — emphasis text/glyph: light `accent-7`, dark
     `accent-4`.
   `.entry-row` selected/hover, `.article-card` selected, `.card-placeholder` glyph,
   and `.site-title:hover` consume these tokens instead of raw ramp picks. At 22%
   alpha the selected tint clears 1.2:1 against `#17171b` for every preset (measured
   1.24–1.43), so selection stays visible while keeping the hue instead of a flat
   near-black brick. Mantine's exported `alpha` helper builds the value, so
   `themes.ts` remains the single source of color. The article-card selected surface
   and placeholder glyph therefore move one ramp step in light mode (from `accent-0`
   / `accent-3` to the shared tint/emphasis tokens), which is why the spec pins the
   light scheme's pale-tint character rather than its exact shades.
5. **Persimmon preset authored to measured floors.** A ten-shade orange ramp from
   `#fff5eb` to `#74380e`, with shade 4 `#f29a45` (8.07:1 on the dark page) and shade
   6 `#d9761f` (3.20:1 against white). `ThemeId`, `THEME_DEFS`, the Settings picker,
   and `isThemeId` extend without touching stored settings; unknown ids keep falling
   back to blue.
6. **Settings swatches preview the scheme's emphasis shade.** A shared helper in
   `themes.ts` exposes the emphasis shade per scheme; `Settings.tsx` uses
   `useComputedColorScheme` to pick it for both the swatch fill and the selection
   ring, so dark-mode users judge presets as rendered.
7. **Sidebar face set on the sidebar container.** `Sidebar` renders its root `Box`
   with `ff={fonts.sans}`; labels, section headings, and actions inherit, badges keep
   `ff="monospace"`. A nested `MantineProvider` or per-component `ff` props would
   duplicate the choice in a dozen places; a theme-wide switch would change the whole
   app. This task ships last and stops for the user's thumbs up/down before any
   follow-up work, per the explicit review request.
8. **Contrast is guarded by a unit test.** A new `apps/web/test/themes.test.ts`
   computes WCAG contrast for every preset: emphasis shade vs `#17171b` ≥ 4.5, filled
   shade vs white ≥ 3, and blends the tint over the page to assert ≥ 1.2. This keeps
   the specs' numeric floors from drifting and catches a bad future preset.

## Risks / Trade-offs

- [Root scaling changes sidebar width and header height, not just text] → That is the
  intent ("everything scales"), but it can reflow narrow-but-tall layouts at exactly
  1600px. Mitigation: verify at 1600px and 1920px in dev, including the mobile-only
  rules, which sit in a different `max-width` block and are unaffected.
- [Relying on Mantine's derived variable names (`-filled`, `-light-color`, `-outline`)]
  → These are documented Mantine CSS variables, but they are library-managed; an
  upgrade could rename them. Mitigation: the failure mode is visible immediately
  (muddy dark emphasis text), and the semantic `--sparkle-accent-*` tokens we own are
  independent of it.
- [Dark emphasis at shade 4 is brighter than today for blue/steel/magenta] → Intent:
  legibility over mutedness. If review finds it too loud, the lever is
  `primaryShade.dark` (5 is a one-line middle ground), not a per-component patch.
- [Tint alpha over the page depends on the page staying `#17171b`] → The page token is
  already pinned by the `theme-surfaces` spec; a future page change would need to
  revisit tint alpha, which the contrast test flags.
- [Sidebar in sans-serif widens text and may wrap feed names] → Sidebar width scales
  with the root size and feed rows already truncate; review the feed list before
  sign-off.
- [Sidebar change is experimental] → It lands last, behind a stop-and-review gate, and
  reverting is removing one `ff` prop.

## Migration Plan

Frontend-only. Ship with the next deploy; no data migration and no stored-setting
change. Rollback is reverting the changed files. If only the sidebar experiment is
rejected, remove the `ff` prop and the corresponding spec/task note without touching
the rest.

## Open Questions

None.
